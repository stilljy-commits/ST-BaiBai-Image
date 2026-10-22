# 柏宝绘 · 流式重构版 0.4.17

安装／更新链接：https://github.com/stilljy-commits/ST-BaiBai-Image

本版改进 cosplay 服装表达：区分人物本人和被 cos 的角色，保留已知作品与具体服装／皮肤版本，使用简短关系说明配合关键衣饰 tags。临时穿着不改写人物身份，关闭自然语言生成也可使用。

同时整理画格与人物取景，减少画外衣物影响镜头，并保持完整穿着供后续镜头复用；明确衣着属于各自人物，减少默认服装回填和混装。标准、简单、极速三种模式均生效，不增加分析轮次。

[完整版本说明](./RELEASE-0.4.17.md)。验证：84 个测试文件，1,126 项通过、3 项既有跳过；类型检查与构建通过。未进行真实模型或 NAI 出图对照，实际还原度与耗时需更新后复测。服装版本需要剧情或资料明确，未知版本不会猜造。

源码：[codex/stream-rebuild](https://github.com/stilljy-commits/ST-BaiBai-Image/tree/codex/stream-rebuild)，提交 ebef022b6d6ec0716021bd4d0e69ded0116c1a25。
