// SPDX-License-Identifier: GPL-2.0-or-later
// Whether TourBox Console holds an older OBS Fadester preset than the one this Companion ships (FIX-9, hand test
// 2026-11-17: an old copy turned the Knob into the mix level instead of the video speed). The Mac panel has the same
// check (Model.swift PresetAge).
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace Fadester.TourBox {
  internal enum PresetState { None, Current, Old }

  internal static class PresetAge {
    static readonly Regex Block = new Regex("<ShortDesc>(.*?)</ShortDesc>", RegexOptions.Singleline | RegexOptions.CultureInvariant);
    static readonly Regex Mods = new Regex("<m>(\\d+)</m>", RegexOptions.CultureInvariant), Key = new Regex("<s>(\\d+)</s>", RegexOptions.CultureInvariant);
    /** A stored preset counts as a Fadester preset when at least this many of its shortcuts... */
    internal const int MinShared = 10;
    /** ...make up at least this share of it. Console's factory presets share at most a tenth with ours. */
    internal const double MinShare = 0.6;

    /**
     * The shortcuts (modifiers and key code) a preset assigns, as "m:s". Console keeps one ShortDesc per shortcut, in the
     * .tb it imports and in the copy it stores; the labels are translated, the shortcuts are not, so this works in every language.
     */
    internal static HashSet<string> Shortcuts(string xml) {
      var found = new HashSet<string>(StringComparer.Ordinal);
      foreach (Match block in Block.Matches(xml ?? "")) {
        Match m = Mods.Match(block.Groups[1].Value), s = Key.Match(block.Groups[1].Value);
        if (m.Success && s.Success) found.Add(m.Groups[1].Value + ":" + s.Groups[1].Value);
      }
      return found;
    }

    /**
     * None: no Fadester preset in Console. Old: one of them lacks a shortcut of the shipped preset, or (when Console kept
     * its import copy) its buttons are laid out differently: 0.12.11 swapped bare Side and Short without changing the set of
     * shortcuts (hand test 2026-11-17). layouts[i] is stored[i]'s button layout, or null when unknown.
     */
    internal static PresetState Judge(HashSet<string> shipped, IList<HashSet<string>> stored, string shippedLayout = null, IList<string> layouts = null) {
      if (shipped == null || shipped.Count == 0) return PresetState.None;
      bool any = false;
      for (int i = 0; i < stored.Count; i++) {
        var preset = stored[i];
        if (!IsFadester(shipped, preset)) continue;
        any = true;
        if (!shipped.IsSubsetOf(preset)) return PresetState.Old;
        string layout = layouts != null && i < layouts.Count ? layouts[i] : null;
        if (shippedLayout != null && layout != null && layout != shippedLayout) return PresetState.Old;
      }
      return any ? PresetState.Current : PresetState.None;
    }

    static readonly Regex LayoutBytes = new Regex(@"<configBytes>\s*([A-Za-z0-9+/=\s]+?)\s*</configBytes>", RegexOptions.CultureInvariant);
    /** A preset's button layout: the configBytes of Console's XML (labels live apart, so it is the same in every language). */
    internal static string Layout(string xml) {
      Match m = LayoutBytes.Match(xml ?? "");
      return m.Success ? Regex.Replace(m.Groups[1].Value, @"\s", "") : null;
    }
    /** The gzip of Console's XML (a shipped .tb, or Console's import copy), read as text; null when it cannot be read. */
    internal static string Unzip(string path) {
      try {
        using (var file = File.OpenRead(path))
        using (var gzip = new GZipStream(file, CompressionMode.Decompress))
        using (var reader = new StreamReader(gzip, Encoding.UTF8)) return reader.ReadToEnd();
      } catch (IOException) { return null; }
      catch (UnauthorizedAccessException) { return null; }
      catch (InvalidDataException) { return null; }
    }

    /** The preset this Companion ships (a gzip of Console's XML), or null when it cannot be read (the caller tries again later). */
    internal static HashSet<string> Shipped(string tbPath) {
      try {
        using (var file = File.OpenRead(tbPath))
        using (var gzip = new GZipStream(file, CompressionMode.Decompress))
        using (var reader = new StreamReader(gzip, Encoding.UTF8)) return Shortcuts(reader.ReadToEnd());
      } catch (IOException) { return null; }
      catch (UnauthorizedAccessException) { return null; }
      catch (InvalidDataException) { return null; }
    }

    /**
     * Console's stored presets: %APPDATA%\TourBox Console\presets\<number> (the .bak files are its own backups).
     * complete is false when a file could not be read or is not finished (no closing </Preset> yet): Console may be writing it.
     */
    internal static List<HashSet<string>> Stored(out bool complete) { List<string> layouts; return Stored(out complete, out layouts); }
    /** layouts: each stored preset's button layout from Console's import copy (import\<number>), or null without one. */
    internal static List<HashSet<string>> Stored(out bool complete, out List<string> layouts) {
      complete = true;
      var found = new List<HashSet<string>>(); layouts = new List<string>();
      string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TourBox Console", "presets");
      if (!Directory.Exists(dir)) return found;
      string[] files;
      try { files = Directory.GetFiles(dir); } catch (IOException) { complete = false; return found; } catch (UnauthorizedAccessException) { complete = false; return found; }
      foreach (string file in files) {
        if (!Path.GetFileName(file).All(char.IsDigit)) continue;
        string xml;
        try { xml = File.ReadAllText(file, Encoding.UTF8); } catch (IOException) { complete = false; continue; } catch (UnauthorizedAccessException) { complete = false; continue; }
        if (!xml.Contains("</Preset>")) { complete = false; continue; }
        found.Add(Shortcuts(xml));
        string copy = Path.Combine(Path.GetDirectoryName(dir), "import", Path.GetFileName(file));
        layouts.Add(File.Exists(copy) ? Layout(Unzip(copy)) : null);
      }
      return found;
    }

    /**
     * TourBox Console's Auto Switch (its customConfig entry switchByProcess): true, false, or null when Console's settings
     * cannot be read. Off, one selected preset serves every application in front (hand test 2026-11-17).
     */
    internal static bool? AutoSwitch() { return ParseAutoSwitch(ReadConsoleFile("customConfig")); }
    static readonly Regex Switch = new Regex(@"<string>switchByProcess</string>\s*<string>(true|false)</string>", RegexOptions.CultureInvariant);
    internal static bool? ParseAutoSwitch(string xml) {
      Match m = Switch.Match(xml ?? "");
      return m.Success ? m.Groups[1].Value == "true" : (bool?)null;
    }

    /** Whether the preset Console has selected (its tableid file names presets\<number>) is a Fadester preset; null when unknown. */
    internal static bool? ActiveIsFadester(HashSet<string> shipped) {
      if (shipped == null || shipped.Count == 0) return null;
      string id = (ReadConsoleFile("tableid") ?? "").Trim();
      if (id.Length == 0 || !id.All(char.IsDigit)) return null;
      string xml = ReadConsoleFile(Path.Combine("presets", id));
      if (xml == null || !xml.Contains("</Preset>")) return null;
      return IsFadester(shipped, Shortcuts(xml));
    }
    internal static bool IsFadester(HashSet<string> shipped, HashSet<string> preset) {
      int shared = preset.Count(shipped.Contains);
      return shared >= MinShared && shared >= MinShare * preset.Count;
    }
    static string ReadConsoleFile(string name) {
      try { return File.ReadAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TourBox Console", name), Encoding.UTF8); }
      catch (IOException) { return null; } catch (UnauthorizedAccessException) { return null; }
    }

    internal static void Test() {
      Func<string, string> desc = pairs => string.Concat(pairs.Split(',').Select(p => "<ShortDesc><m>" + p.Split(':')[0] + "</m><s>" + p.Split(':')[1] + "</s><d>x</d></ShortDesc>"));
      var shipped = Shortcuts("<Preset>" + desc(string.Join(",", Enumerable.Range(1, 20).Select(i => "14:" + i))) + "</Preset>");
      var current = new HashSet<string>(shipped);
      var old = Shortcuts(desc(string.Join(",", Enumerable.Range(1, 15).Select(i => "14:" + i))));
      var factory = Shortcuts(desc(string.Join(",", Enumerable.Range(1, 3).Select(i => "14:" + i).Concat(Enumerable.Range(100, 60).Select(i => "2:" + i)))));
      if (shipped.Count != 20 || !shipped.Contains("14:7")) throw new InvalidOperationException("Preset shortcuts parse");
      if (Judge(shipped, new[] { factory }) != PresetState.None || Judge(shipped, new[] { factory, current }) != PresetState.Current ||
          Judge(shipped, new[] { old }) != PresetState.Old || Judge(shipped, new[] { current, old }) != PresetState.Old ||
          Judge(new HashSet<string>(), new[] { old }) != PresetState.None)
        throw new InvalidOperationException("Preset age decision");
      if (ParseAutoSwitch("<map><entry><string>switchByProcess</string>\n    <string>false</string></entry></map>") != false ||
          ParseAutoSwitch("<entry><string>switchByProcess</string><string>true</string></entry>") != true || ParseAutoSwitch("<map/>") != null ||
          !IsFadester(shipped, current) || IsFadester(shipped, factory))
        throw new InvalidOperationException("Console settings");
      var shippedOnly = new List<HashSet<string>> { current };
      if (Judge(shipped, shippedOnly, "AAA", new List<string> { "AAA" }) != PresetState.Current || Judge(shipped, shippedOnly, "AAA", new List<string> { "BBB" }) != PresetState.Old ||
          Judge(shipped, shippedOnly, "AAA", new List<string> { null }) != PresetState.Current ||
          Layout("<TableTransfer><configBytes>QUJD\n  REVG</configBytes>") != "QUJDREVG" || Layout("<Preset/>") != null)
        throw new InvalidOperationException("Preset layout");
    }
  }
}
