; The 13 languages of Fadester Suite Setup and the Fadester Companion installer (included under [Languages]).
; Inno Setup's own pages come from its language files; this folder's <code>.isl adds the Fadester messages.
; Inno Setup ships no Chinese file: zh-CN.isl and zh-TW.isl also translate the pages these setups show.
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "de"; MessagesFile: "compiler:Languages\German.isl,lang\de.isl"
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl,lang\es.isl"
Name: "fr"; MessagesFile: "compiler:Languages\French.isl,lang\fr.isl"
Name: "it"; MessagesFile: "compiler:Languages\Italian.isl,lang\it.isl"
Name: "ja"; MessagesFile: "compiler:Languages\Japanese.isl,lang\ja.isl"
#if FileExists(CompilerPath + "Languages\Korean.isl")
Name: "ko"; MessagesFile: "compiler:Languages\Korean.isl,lang\ko.isl"
#else
; An Inno Setup without a Korean file: the Fadester messages are Korean, Inno Setup's own pages English.
Name: "ko"; MessagesFile: "compiler:Default.isl,lang\ko-options.isl,lang\ko.isl"
#endif
Name: "nl"; MessagesFile: "compiler:Languages\Dutch.isl,lang\nl.isl"
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl,lang\pt-BR.isl"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl,lang\ru.isl"
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl,lang\tr.isl"
#if FileExists(CompilerPath + "Languages\ChineseSimplified.isl")
Name: "zhcn"; MessagesFile: "compiler:Languages\ChineseSimplified.isl,lang\zh-CN.isl"
#else
Name: "zhcn"; MessagesFile: "compiler:Default.isl,lang\zh-CN-pages.isl,lang\zh-CN.isl"
#endif
#if FileExists(CompilerPath + "Languages\ChineseTraditional.isl")
Name: "zhtw"; MessagesFile: "compiler:Languages\ChineseTraditional.isl,lang\zh-TW.isl"
#else
Name: "zhtw"; MessagesFile: "compiler:Default.isl,lang\zh-TW-pages.isl,lang\zh-TW.isl"
#endif
