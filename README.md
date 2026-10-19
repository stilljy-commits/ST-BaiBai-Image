# 柏宝绘 · 流式重构版 0.4.15

安装／更新链接：https://github.com/stilljy-commits/ST-BaiBai-Image

本版修复部分预设隐藏标记、正文格式变化或折叠区域导致的流式提前插图问题，并优化漫画人物与画格归属、同人身份、换装延续和逐人物排除词。经典四格保留四格，其他方案按事件自然取舍；取消极速模式固定底部主格的旧处理。

漫画标准、简单、极速三种分析模式及流式／整楼分析均覆盖相应规则；正常流程不增加 AI 调用，不改模型、推理强度、合批和并发选择。五组附加规则与现有开关继续使用。NAI Medium 不支持自定义人物排除词。

[完整版本说明](./RELEASE-0.4.15.md)。验证：84 个测试文件，1,113 项通过、3 项既有跳过；类型检查与构建通过，Chrome／Edge 各 41 项浏览器检查通过。没有向真实模型或 NAI 发起画质／耗时对照测试，最终效果仍需实际剧情验证。

源码：[codex/stream-rebuild](https://github.com/stilljy-commits/ST-BaiBai-Image/tree/codex/stream-rebuild)，提交 8f160f299e6825c15d4ac502e426e031d5c03493。
