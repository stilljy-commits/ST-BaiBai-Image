# 柏宝绘 · 流式重构版 0.4.1

安装/更新链接：https://github.com/stilljy-commits/ST-BaiBai-Image

基于原版 0.3.2，保留 0.4.0 已通过用户实测的流式出图和正文结束立即显示图片/在途位置。

本版修改：

- 每次正文生成重新注册标记规则，并在主请求组装后检查、补入缺失规则；已有世界书规则时不重复添加，quiet/tags 请求不污染。
- 世界书数量同步兼容用户原句与常见写法；跳过无数量句的同标题条目；优先读写宿主当前世界书，刷新激活缓存。
- tags 分析消除当前目标段的重复输入，缓存固定模块入口，新增排队/准备/副 API 耗时。保持模型、并发、设定、角色库与思考规则。

更新刷新后，先关闭“流式生图”世界书复测自动标记，再开启并在插件中填书名“流式生图”，修改最少/最多数量验证同步。

[详细修改与复测说明](https://github.com/stilljy-commits/ST-BaiBai-Image/blob/codex/stream-rebuild/RELEASE-0.4.1.md)。

验证：67 个测试文件，849 项通过、3 项原有跳过；完整类型检查和生产构建通过。本次没有调用真实副 API 或 NAI，不报告未实测的加速百分比。

main 是酒馆发布文件；完整源码在 codex/stream-rebuild。源码提交：[93a2edddaf1c6aa4c18efee2ff8b2eee434f5a67](https://github.com/stilljy-commits/ST-BaiBai-Image/commit/93a2edddaf1c6aa4c18efee2ff8b2eee434f5a67)。

原作者及上游：[baibai-git/ST-BaiBai-Image](https://github.com/baibai-git/ST-BaiBai-Image)。
