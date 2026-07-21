# PDF 字体资源约定

ArtScape 报告使用支持中文的字体。容器镜像通过 Debian `fonts-noto-cjk` 包提供
SIL Open Font License 1.1 授权的 Noto Sans CJK；Windows 使用系统微软雅黑/黑体，
macOS 使用系统苹方。生产环境也可通过 `ARTSCAPE_PDF_FONT` 指定同等授权字体的绝对路径。

如果指定的是包含多种子字体的 `.ttc` 集合，还必须通过
`ARTSCAPE_PDF_FONT_FAMILY` 指定 PostScript 子字体名，例如
`NotoSansCJKsc-Regular`。渲染器不会静默回退到不支持中文的 Helvetica；
字体路径或子字体配置错误会直接让报告任务失败并返回明确错误。

镜像构建同时安装 `poppler-utils`，用于发布前把 PDF 渲染为 PNG 并检查分页、溢出和乱码。
