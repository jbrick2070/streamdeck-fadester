// SPDX-License-Identifier: GPL-2.0-or-later
// Temporary compatibility re-export shim; import from streamdeck-fadester-shared directly in new code.
export {
  type DialCellRenderInput,
  type KeyCellRenderInput,
  escapeXml,
  truncateLabel,
  toSvgDataUri,
  renderDialCellSvg,
  renderAutoFadeKeySvg
} from "../../packages/streamdeck-fadester-shared/src/svg-renderer.js";
