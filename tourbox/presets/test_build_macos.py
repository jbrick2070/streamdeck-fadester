"""Offline parity checks; no Console, device or OBS access."""
import base64
import gzip
import hashlib
import json
import unittest
import xml.etree.ElementTree as ET

import build as windows
import build_macos as mac


def offsets(preset):
    return [22 + windows.slot(row) * 13 + (8 if row["gesture"] == "cw" else 3) for row in preset["bindings"]]


class MacPresetTests(unittest.TestCase):
    def setUp(self):
        self.preset = json.loads((mac.HERE / "map.json").read_text(encoding="utf-8"))["presets"]["master"]

    def test_matches_actual_mac_modifier_calibration(self):
        # Mac Console 5.12.1 factory JSON and native stored table agree on these.
        samples = [
            ("18000001000000540000000000", 1, "Control+T"),
            ("16000003000000520000000000", 3, "Control+Shift+R"),
            ("0a000008000000300000000000", 8, "Command+0"),
            ("00000004000000000000000000", 4, "Option"),
            ("02000002000000000000000000", 2, "Shift"),
        ]
        for record, mask, label in samples:
            self.assertEqual(bytes.fromhex(record)[3], mask, label)
        self.assertEqual(mac.MAC_MASK, 1 | 2 | 4)
        self.assertEqual(mac.MAC_MASK & 8, 0)
        # Windows Ctrl+Alt+Shift, Ctrl+Shift and Alt+Shift become Control+Option+Shift,
        # Control+Shift and Option+Shift, and back. Command is never produced.
        self.assertEqual([mac.to_mac(m) for m in (14, 10, 6)], [7, 3, 6])
        self.assertEqual([mac.to_windows(m) for m in (7, 3, 6)], [14, 10, 6])
        for bad in (0, 1, 2, 3, 7, 8, 15):  # a lone modifier, a Mac mask, or an unknown bit
            with self.assertRaises(ValueError):
                mac.to_mac(bad)
        for bad in (0, 1, 2, 8, 10, 11, 14):  # a lone modifier, Command, or a Windows mask
            with self.assertRaises(ValueError):
                mac.to_windows(bad)

    def test_all_keys_labels_and_menu_target_mac_control_not_command(self):
        data = mac.build(self.preset)
        root = ET.fromstring(gzip.decompress(data))
        table = base64.b64decode(root.findtext("configBytes"))
        source = base64.b64decode(ET.fromstring(gzip.decompress(windows.build(self.preset))).findtext("configBytes"))
        self.assertTrue({source[i] for i in offsets(self.preset)} <= {14, 10, 6})
        for offset in offsets(self.preset):
            self.assertEqual(table[offset], mac.to_mac(source[offset]))
            self.assertEqual(table[offset] & 8, 0)
        labels = {int(e.text) for e in root.findall("shortCuts/ShortDesc/m")}
        menu = {int(e.text) for e in root.findall("tourMenuBox/menus/TourMenu/items/TourMenuItem/mask")}
        self.assertIn(7, labels)
        self.assertTrue(labels <= {7, 3, 6} and menu <= {7, 3, 6})
        self.assertEqual(root.findtext("presetName"), "OBS Fadester for TourBox")
        mac.check(self.preset, data)

    def test_only_physical_modifier_bytes_change_in_native_table(self):
        a = ET.fromstring(gzip.decompress(windows.build(self.preset)))
        b = ET.fromstring(gzip.decompress(mac.build(self.preset)))
        before, after = (base64.b64decode(root.findtext("configBytes")) for root in (a, b))
        differences = [i for i, pair in enumerate(zip(before, after)) if pair[0] != pair[1]]
        # Alt+Shift is 6 on both platforms, so those bytes stay as they are.
        expected = [i for i in offsets(self.preset) if mac.to_mac(before[i]) != before[i]]
        self.assertTrue(expected)
        self.assertEqual(sorted(differences), sorted(expected))
        self.assertEqual(before[:22], after[:22])  # Header byte1 is pluginId, not an OS identifier.
        for name in ["presetConf", "hudList"]:
            self.assertEqual(ET.tostring(a.find(name)), ET.tostring(b.find(name)))

    def test_wrong_menu_mask_or_unrelated_change_is_rejected(self):
        for path, text in [("tourMenuBox/menus/TourMenu/items/TourMenuItem/mask", "14"),
                           ("shortCuts/ShortDesc/m", "8"), ("presetName", "Other preset")]:
            root = ET.fromstring(gzip.decompress(mac.build(self.preset)))
            root.find(path).text = text
            with self.assertRaises(ValueError):
                mac.check(self.preset, mac.pack(root))

    def test_deterministic_and_windows_file_unchanged(self):
        path = mac.HERE / self.preset["file"]
        before = hashlib.sha256(path.read_bytes()).digest()
        self.assertEqual(mac.build(self.preset), mac.build(self.preset))
        self.assertEqual(hashlib.sha256(path.read_bytes()).digest(), before)


if __name__ == "__main__":
    unittest.main()
