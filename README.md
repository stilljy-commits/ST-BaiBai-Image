# 柏宝绘 · 流式重构版 0.4.4

安装/更新链接：https://github.com/stilljy-commits/ST-BaiBai-Image

分镜下拉框原本会更新发送规则，但说明写死为默认方案。本版让分镜与留白说明随选择更新，并说明流式一轮开始时固定方案、下一轮采用新选择。

对照1.3.1原始方案，恢复经典四格的均衡四格、轻松日常的规整松弛节拍、喜剧日常的规整画格与表情对切；V1/V2的规范和思考检查不再强迫这三类使用“单一主格占半页以上”。其他风格保留现有核心规则。

保留0.4.3的固定三段分析、数量范围优先于字数密度，以及0.4.2的图片原位更新。

八种分镜区别、四种留白及生效时机：[完整版本说明](https://github.com/stilljy-commits/ST-BaiBai-Image/blob/codex/stream-rebuild/RELEASE-0.4.4.md)。已有图片需重新分析提示词后再生成，沿用旧tags重绘仍是旧构图。

验证：70个测试文件，908项通过、3项原有跳过；类型检查和生产构建通过。覆盖八种分镜×V1/V2、四种留白、流式快照与下一轮新选择、未启用漫画或非V5模型、均衡风格规则一致性。未主动调用真实tags API或NAI，不将请求内容验证等同于实图效果保证。

main是酒馆发布文件；完整源码在codex/stream-rebuild。源码提交：[7cc9e660c347c9471f208091f511f0036464f28d](https://github.com/stilljy-commits/ST-BaiBai-Image/commit/7cc9e660c347c9471f208091f511f0036464f28d)。

原作者及上游：[baibai-git/ST-BaiBai-Image](https://github.com/baibai-git/ST-BaiBai-Image)。
