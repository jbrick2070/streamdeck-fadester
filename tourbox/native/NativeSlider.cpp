// SPDX-License-Identifier: GPL-2.0-or-later
// Private line protocol with the bridge: READ or "<expected> <desired>" in OBS's integer units.
#include <windows.h>
#include <UIAutomation.h>
#include <wrl/client.h>
#include <charconv>
#include <cmath>
#include <filesystem>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using Microsoft::WRL::ComPtr;
constexpr wchar_t mainId[] = L"OBSApp.OBSBasic";
constexpr wchar_t sliderId[] = L"OBSApp.OBSBasic.centralwidget.canvasEditor.QWidget.SliderIgnoreScroll";
constexpr int maximum = 1023;

void check(HRESULT result, const char *operation)
{
    if (FAILED(result)) throw std::runtime_error(operation);
}

struct CloseHandleDeleter {
    void operator()(void *handle) const { CloseHandle(handle); }
};
using ProcessHandle = std::unique_ptr<void, CloseHandleDeleter>;

// Release every string returned by UI Automation, including on property lookup failure.
using TextGetter = HRESULT(STDMETHODCALLTYPE IUIAutomationElement::*)(BSTR *);
bool textEquals(IUIAutomationElement *element, TextGetter getter, const wchar_t *expected)
{
    BSTR value = nullptr;
    HRESULT result = (element->*getter)(&value);
    bool equal = SUCCEEDED(result) && value && std::wstring_view(value, SysStringLen(value)) == expected;
    SysFreeString(value);
    return equal;
}

bool integer(const std::string &s, int &result)
{
    if (s.empty() || s.front() < '0' || s.front() > '9') return false;
    auto end = s.data() + s.size();
    auto parsed = std::from_chars(s.data(), end, result);
    return parsed.ec == std::errc{} && parsed.ptr == end;
}

class Target {
public:
    explicit Target(int id) : pid(id), process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, id))
    {
        if (!process) throw std::runtime_error("target OBS process unavailable");
        wchar_t path[32768];
        DWORD length = static_cast<DWORD>(std::size(path));
        if (!QueryFullProcessImageNameW(process.get(), 0, path, &length) ||
            _wcsicmp(std::filesystem::path(path).filename().c_str(), L"obs64.exe") != 0)
            throw std::runtime_error("target is not the OBS process");
        check(CoCreateInstance(__uuidof(CUIAutomation8), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&uia)),
              "Windows UI Automation 2 unavailable");
        // UIA normally tries to focus a control before each write. This can stall for two
        // seconds on an unfocused desktop and is inappropriate for a live production.
        check(uia->put_AutoSetFocus(FALSE), "cannot disable automatic UI focus");
        BOOL autoFocus = TRUE;
        check(uia->get_AutoSetFocus(&autoFocus), "cannot verify automatic UI focus setting");
        if (autoFocus) throw std::runtime_error("UI Automation would change focus");
    }

    std::string command(const std::string &line)
    {
        if (uncertain) return "ERR prior write unconfirmed; restart helper";
        std::istringstream words(line);
        std::string first, second, extra;
        words >> first;
        bool readOnly = first == "READ";
        int expected = 0, desired = 0;
        if ((!readOnly && (!(words >> second) || !integer(first, expected) || !integer(second, desired) ||
                           expected > maximum || desired > maximum)) || (words >> extra))
            return "ERR expected READ or two integers 0..1023";
        bool invoked = false;
        try {
            bool reused = locate();
            int before = 0;
            try {
                before = read();
            } catch (const std::exception &) {
                // OBS can rebuild its T-bar (Studio Mode turned off and on), so a slider found earlier may be gone.
                // Nothing has been written yet: look it up once more before giving up.
                if (!reused) throw;
                forget();
                locate();
                before = read();
            }
            if (readOnly) return "OK " + std::to_string(before);
            if (before != expected) return "ERR T-bar moved; actual " + std::to_string(before);
            if (before == desired) return "OK " + std::to_string(before);
            invoked = true;
            check(range->SetValue(desired), "native slider setter failed");
            int actual = read();
            if (actual != desired) throw std::runtime_error("native slider readback mismatch");
            return "OK " + std::to_string(actual);
        } catch (const std::exception &e) {
            uncertain = invoked; // An in-flight failed write may have taken effect. Never replay it.
            forget();
            return std::string(invoked ? "ERR write unconfirmed: " : "ERR ") + e.what();
        }
    }

private:
    void forget()
    {
        range.Reset();
        slider.Reset();
        mainWindow = nullptr;
    }
    bool running() const { return WaitForSingleObject(process.get(), 0) == WAIT_TIMEOUT; }
    bool owns(HWND hwnd) const
    {
        DWORD actual = 0;
        return hwnd && IsWindow(hwnd) && GetWindowThreadProcessId(hwnd, &actual) && actual == static_cast<DWORD>(pid);
    }
    struct WindowSearch { Target *self; std::vector<HWND> owned; };
    static BOOL CALLBACK collect(HWND window, LPARAM parameter)
    {
        auto *search = reinterpret_cast<WindowSearch *>(parameter);
        if (search->self->owns(window)) search->owned.push_back(window);
        return TRUE;
    }

    // Returns true when the slider found earlier was kept rather than looked up again.
    bool locate()
    {
        if (!running()) throw std::runtime_error("OBS process exited");
        if (range && owns(mainWindow)) return true;
        WindowSearch search{this, {}};
        EnumWindows(collect, reinterpret_cast<LPARAM>(&search));
        ComPtr<IUIAutomationElement> root;
        for (HWND window : search.owned) {
            ComPtr<IUIAutomationElement> candidate;
            int owner = 0;
            if (FAILED(uia->ElementFromHandle(window, &candidate)) || !candidate ||
                FAILED(candidate->get_CurrentProcessId(&owner)) || owner != pid ||
                !textEquals(candidate.Get(), &IUIAutomationElement::get_CurrentClassName, L"OBSBasic") ||
                !textEquals(candidate.Get(), &IUIAutomationElement::get_CurrentAutomationId, mainId) ||
                !textEquals(candidate.Get(), &IUIAutomationElement::get_CurrentFrameworkId, L"Qt")) continue;
            if (root) throw std::runtime_error("ambiguous OBS main window");
            root = candidate;
            mainWindow = window;
        }
        if (!root) throw std::runtime_error("Cannot find the main OBS window. Keep it open on this desktop, with Studio Mode on and the T-bar visible.");
        VARIANT id{};
        id.vt = VT_BSTR;
        id.bstrVal = SysAllocString(sliderId);
        if (!id.bstrVal) throw std::bad_alloc();
        ComPtr<IUIAutomationCondition> match;
        HRESULT result = uia->CreatePropertyCondition(UIA_AutomationIdPropertyId, id, &match);
        VariantClear(&id);
        check(result, "cannot locate the native Studio Mode T-bar");
        ComPtr<IUIAutomationElementArray> found;
        check(root->FindAll(TreeScope_Descendants, match.Get(), &found), "native Studio Mode T-bar unavailable");
        int count = 0;
        if (!found || FAILED(found->get_Length(&count)) || count != 1) throw std::runtime_error("Cannot find the T-bar in OBS. Keep the main OBS window open, with Studio Mode on and the T-bar visible.");
        check(found->GetElement(0, &slider), "native Studio Mode T-bar unavailable");
        int owner = 0; CONTROLTYPEID type = 0;
        if (!slider || FAILED(slider->get_CurrentProcessId(&owner)) || owner != pid ||
            FAILED(slider->get_CurrentControlType(&type)) || type != UIA_SliderControlTypeId ||
            !textEquals(slider.Get(), &IUIAutomationElement::get_CurrentClassName, L"SliderIgnoreScroll") ||
            !textEquals(slider.Get(), &IUIAutomationElement::get_CurrentFrameworkId, L"Qt"))
            throw std::runtime_error("native Studio Mode slider identity mismatch");
        check(slider->GetCurrentPatternAs(UIA_RangeValuePatternId, IID_PPV_ARGS(&range)), "native T-bar range provider unavailable");
        if (!range) throw std::runtime_error("native T-bar range provider unavailable");
        return false;
    }

    int read()
    {
        if (!running() || !owns(mainWindow)) throw std::runtime_error("OBS window no longer owned");
        BOOL enabled = FALSE, readOnly = TRUE;
        double min = 0, max = 0, value = 0;
        if (FAILED(slider->get_CurrentIsEnabled(&enabled)) || !enabled ||
            FAILED(range->get_CurrentIsReadOnly(&readOnly)) || readOnly ||
            FAILED(range->get_CurrentMinimum(&min)) || min != 0 ||
            FAILED(range->get_CurrentMaximum(&max)) || max != maximum)
            throw std::runtime_error("native T-bar disabled or range changed");
        check(range->get_CurrentValue(&value), "cannot read native T-bar position");
        if (!(value >= 0 && value <= maximum) || value != std::trunc(value)) throw std::runtime_error("invalid native T-bar position");
        return static_cast<int>(value);
    }

    const int pid;
    ProcessHandle process;
    ComPtr<IUIAutomation2> uia;
    HWND mainWindow = nullptr;
    ComPtr<IUIAutomationElement> slider;
    ComPtr<IUIAutomationRangeValuePattern> range;
    bool uncertain = false;
};
}

int main(int argc, char **argv)
{
    int pid = 0;
    if (argc != 2 || !integer(argv[1], pid) || pid <= 0) return 2;
    HRESULT initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    {
        std::unique_ptr<Target> target;
        std::string failure = "cannot initialize Windows UI Automation";
        if (SUCCEEDED(initialized)) {
            try { target = std::make_unique<Target>(pid); }
            catch (const std::exception &e) { failure = e.what(); } // Pin failure, never bind to a recycled PID.
        }
        std::string line;
        while (std::getline(std::cin, line))
            std::cout << (target ? target->command(line) : "ERR " + failure) << std::endl;
    }
    if (SUCCEEDED(initialized)) CoUninitialize();
    return 0;
}
