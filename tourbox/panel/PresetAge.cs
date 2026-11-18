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

    /** None: no Fadester preset in Console. Old: one of them lacks a shortcut of the shipped preset (Auto Switch may pick it). */
    internal static PresetState Judge(HashSet<string> shipped, IEnumerable<HashSet<string>> stored) {
      if (shipped == null || shipped.Count == 0) return PresetState.None;
      bool any = false;
      foreach (var preset in stored) {
        int shared = preset.Count(shipped.Contains);
        if (shared < MinShared || shared < MinShare * preset.Count) continue;
        any = true;
        if (!shipped.IsSubsetOf(preset)) return PresetState.Old;
      }
      return any ? PresetState.Current : PresetState.None;
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
    internal static List<HashSet<string>> Stored(out bool complete) {
      complete = true;
      var found = new List<HashSet<string>>();
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
      }
      return found;
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
    }
  }
}
