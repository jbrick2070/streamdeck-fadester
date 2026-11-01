// SPDX-License-Identifier: GPL-2.0-or-later
// VJster OBS page: the setup notes in the operator's language (docs/vjster/
// REQUIREMENTS.md R-I18N-1, R-I18N-3; PLAN.md 8.6). The page shows text only
// when its address is incomplete or YouTube's player does not load, and it
// shows it in the OBS output, so the notes are short.
//
// The language comes from the `hl=` parameter the plugin puts in the address
// (Stream Deck's language), else from the browser (OBS's language), else
// English. A text missing in a language is shown in English.
//
// The English texts were written with Claude Opus 5.5, an AI model; the other
// languages were drafted by Claude Opus 5.5 and reviewed by a second AI model,
// Gemini 4 Argon (PLAN.md 8.7). Corrections: docs/vjster/INSTALL.md.

export const NOTE_KEYS = ["noToken", "noVideo", "playerMissing", "retry"] as const;
export type NoteKey = (typeof NOTE_KEYS)[number];
export type Notes = Readonly<Record<NoteKey, string>>;

/** The notes by language; `{s}` is a number of seconds. */
export const NOTES: Readonly<Record<string, Partial<Notes>>> = {
  en: {
    noToken: "VJster: this address has no token. Copy the OBS page address from the VJster settings in Stream Deck.",
    noVideo: "VJster: add ?v= and a YouTube video id to this address.",
    playerMissing: "VJster: YouTube's player did not load.",
    retry: "VJster: YouTube's player could not be loaded; trying again in {s} s."
  },
  de: {
    noToken: "VJster: Diese Adresse hat keinen Schlüssel. Die Adresse der OBS-Seite aus den VJster-Einstellungen in Stream Deck kopieren.",
    noVideo: "VJster: ?v= und eine YouTube-Video-ID an diese Adresse anhängen.",
    playerMissing: "VJster: Der YouTube-Player wurde nicht geladen.",
    retry: "VJster: Der YouTube-Player konnte nicht geladen werden; neuer Versuch in {s} s."
  },
  es: {
    noToken: "VJster: esta dirección no tiene clave. Copia la dirección de la página de OBS desde los ajustes de VJster en Stream Deck.",
    noVideo: "VJster: añade ?v= y un ID de vídeo de YouTube a esta dirección.",
    playerMissing: "VJster: el reproductor de YouTube no se ha cargado.",
    retry: "VJster: no se ha podido cargar el reproductor de YouTube; nuevo intento en {s} s."
  },
  fr: {
    noToken: "VJster : cette adresse n'a pas de clé. Copiez l'adresse de la page OBS depuis les paramètres VJster dans Stream Deck.",
    noVideo: "VJster : ajoutez ?v= et un ID de vidéo YouTube à cette adresse.",
    playerMissing: "VJster : le lecteur YouTube ne s'est pas chargé.",
    retry: "VJster : le lecteur YouTube n'a pas pu être chargé ; nouvel essai dans {s} s."
  },
  ja: {
    noToken: "VJster: このアドレスにはキーがありません。Stream Deck の VJster 設定から OBS ページのアドレスをコピーしてください。",
    noVideo: "VJster: このアドレスに ?v= と YouTube の動画 ID を追加してください。",
    playerMissing: "VJster: YouTube のプレーヤーを読み込めませんでした。",
    retry: "VJster: YouTube のプレーヤーを読み込めませんでした。{s} 秒後に再試行します。"
  },
  ko: {
    noToken: "VJster: 이 주소에 키가 없습니다. Stream Deck의 VJster 설정에서 OBS 페이지 주소를 복사하세요.",
    noVideo: "VJster: 이 주소에 ?v=와 YouTube 동영상 ID를 추가하세요.",
    playerMissing: "VJster: YouTube 플레이어가 로드되지 않았습니다.",
    retry: "VJster: YouTube 플레이어를 로드하지 못했습니다. {s}초 후에 다시 시도합니다."
  },
  pt_BR: {
    noToken: "VJster: este endereço não tem token. Copie o endereço da página do OBS nas configurações do VJster no Stream Deck.",
    noVideo: "VJster: adicione ?v= e o ID de um vídeo do YouTube a este endereço.",
    playerMissing: "VJster: o player do YouTube não carregou.",
    retry: "VJster: não foi possível carregar o player do YouTube; nova tentativa em {s} s."
  },
  ru: {
    noToken: "VJster: в этом адресе нет токена. Скопируйте адрес страницы OBS из настроек VJster в Stream Deck.",
    noVideo: "VJster: добавьте к этому адресу ?v= и идентификатор видео YouTube.",
    playerMissing: "VJster: проигрыватель YouTube не загрузился.",
    retry: "VJster: не удалось загрузить проигрыватель YouTube; повторная попытка через {s} сек."
  },
  tr: {
    noToken: "VJster: bu adreste belirteç yok. OBS sayfasının adresini Stream Deck'teki VJster ayarlarından kopyalayın.",
    noVideo: "VJster: bu adrese ?v= ve bir YouTube video kimliği ekleyin.",
    playerMissing: "VJster: YouTube oynatıcısı yüklenmedi.",
    retry: "VJster: YouTube oynatıcısı yüklenemedi; {s} saniye sonra yeniden denenecek."
  },
  zh_CN: {
    noToken: "VJster: 此地址没有密钥。请从 Stream Deck 中的 VJster 设置复制 OBS 页面地址。",
    noVideo: "VJster: 请在此地址后添加 ?v= 和一个 YouTube 视频 ID。",
    playerMissing: "VJster: YouTube 播放器未加载。",
    retry: "VJster: 无法加载 YouTube 播放器；将在 {s} 秒后重试。"
  },
  zh_TW: {
    noToken: "VJster: 此位址沒有金鑰。請從 Stream Deck 中的 VJster 設定複製 OBS 頁面位址。",
    noVideo: "VJster: 請在此位址加上 ?v= 與 YouTube 影片 ID。",
    playerMissing: "VJster: YouTube 播放器未載入。",
    retry: "VJster: 無法載入 YouTube 播放器；將在 {s} 秒後重試。"
  }
};

/** Other names for a language the table has: Chinese without a region is simplified, Hong Kong and Macau traditional. */
const ALIASES: Readonly<Record<string, string>> = { zh: "zh_CN", zh_HK: "zh_TW", zh_MO: "zh_TW", zh_SG: "zh_CN", pt: "pt_BR" };

const has = (lang: string): boolean => Object.prototype.hasOwnProperty.call(NOTES, lang);

/**
 * The table's language for a language tag such as `de`, `de-AT`, `pt-BR`,
 * `zh_CN` or `zh-Hant-TW`: for Chinese the script first (Hans simplified,
 * Hant traditional), then the exact language and region, an alias, the
 * language alone, else English.
 */
export function pageLanguage(tag: string | null | undefined): string {
  if (typeof tag !== "string") return "en";
  const parts = tag.trim().split(/[-_]/).filter((p) => p !== "");
  const base = (parts[0] ?? "").toLowerCase();
  const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p))?.toUpperCase();
  const script = parts.slice(1).find((p) => /^[A-Za-z]{4}$/.test(p))?.toLowerCase();
  const alias = (name: string): string => (Object.prototype.hasOwnProperty.call(ALIASES, name) ? ALIASES[name] : "");
  const tries = [
    base === "zh" && script === "hant" ? "zh_TW" : "",
    base === "zh" && script === "hans" ? "zh_CN" : "",
    region ? `${base}_${region}` : "",
    region ? alias(`${base}_${region}`) : "",
    alias(base),
    base
  ];
  return tries.find((t) => t !== "" && has(t)) ?? "en";
}

/** A note in `lang` with its placeholders filled; English where `lang` has none. */
export function note(lang: string, key: NoteKey, values: Readonly<Record<string, string>> = {}): string {
  const own = has(lang) ? NOTES[lang][key] : undefined;
  const text = own !== undefined && own !== "" ? own : (NOTES.en[key] as string);
  return text.replace(/\{([a-z]+)\}/g, (all, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : all));
}
