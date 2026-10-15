# 柏宝绘 · 流式重构版 0.4.10

安装/更新链接：https://github.com/stilljy-commits/ST-BaiBai-Image

新增「简单模式 / 标准模式」。NAI渠道开启漫画页模式后，在「漫画分析模式」选择；升级后默认保留标准模式，可随时切回。简单模式围绕核心事件直接写提示词，减少细部推敲，普通事件以2～3格为主；经典四格仍为四格，分镜风格、对白与自定义附加规则继续生效。

V1/V2、角色库及变化时序、固定每3个标记合批、短尾批、图片原位更新与浮层收尾保留。进行中的流式轮次沿用开始时的模式。模型、思考强度及NAI参数沿用用户设置。

验证：72个测试文件，954项通过、3项原有跳过；类型检查与生产构建通过。8组离线提示词对照中，标准模式与0.4.9完全一致。未主动调用真实tags或NAI接口，实际速度和画面效果需要对照测试。

[完整版本说明](https://github.com/stilljy-commits/ST-BaiBai-Image/blob/codex/stream-rebuild/RELEASE-0.4.10.md)。main存放酒馆发布文件，完整源码在codex/stream-rebuild。源码提交：[956a8dc6403e5103d74624421714c418c87d94e0](https://github.com/stilljy-commits/ST-BaiBai-Image/commit/956a8dc6403e5103d74624421714c418c87d94e0)。

原作者及上游：[baibai-git/ST-BaiBai-Image](https://github.com/baibai-git/ST-BaiBai-Image)。
