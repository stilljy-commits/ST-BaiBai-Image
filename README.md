# 柏宝绘 · 流式重构版 0.4.5

安装/更新链接：https://github.com/stilljy-commits/ST-BaiBai-Image

按原预设修正为“通用映画文法 + 一种分镜风格”：共同文法始终启用，再叠加七种风格之一。原“通用映画”选择改称“仅通用规则（不附加风格）”，保留原存储值，不改成其他风格。默认仍为本子肉感。

通用文法负责景别、阅读顺序、空间位置、环境建立、动作及状态连续性；附加风格决定格形与节奏，留白方案单独决定边界。V1/V2都支持，说明随选择更新；经典四格、两类日常及仅通用规则不强制主格过半。

保留固定三段分析及图片原位更新。新的选择适用于新生成的tags，进行中的流式轮次沿用开始时固定的设置；已有tags需重新分析才会换构图。

[完整版本说明](https://github.com/stilljy-commits/ST-BaiBai-Image/blob/codex/stream-rebuild/RELEASE-0.4.5.md)。验证：70个测试文件，909项通过、3项原有跳过；类型检查与生产构建通过。覆盖共同文法只出现一次、仅所选风格进入请求、旧设置兼容及流式快照。未主动调用真实tags或NAI接口。

main存放酒馆发布文件；完整源码在codex/stream-rebuild。源码提交：[30def9bdb7a9114741096f9ab579a0d581d7616b](https://github.com/stilljy-commits/ST-BaiBai-Image/commit/30def9bdb7a9114741096f9ab579a0d581d7616b)。

原作者及上游：[baibai-git/ST-BaiBai-Image](https://github.com/baibai-git/ST-BaiBai-Image)。
