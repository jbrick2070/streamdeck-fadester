// SPDX-License-Identifier: GPL-2.0-or-later
// Time limits shared by the main thread (native-tbar.ts) and the macOS Accessibility worker (ax/ax-slider.ts), so the
// main thread never gives up on a read the worker is still allowed to spend searching for OBS's slider.

/** How long the macOS worker may search OBS's Accessibility tree for the T-bar slider in one call. */
export const AX_TRAVERSAL_BUDGET_MS = 1500;
/** Room on top of the search for the one-time Accessibility check and the slider's own reads (80 ms each at most). */
export const AX_READ_MARGIN_MS = 400;
