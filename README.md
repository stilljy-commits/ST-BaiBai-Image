# 柏宝绘 · 流式重构版 0.4.3

安装/更新链接：https://github.com/stilljy-commits/ST-BaiBai-Image

按最多图片数固定分三段分析：最多10张为3、3、4。每段收齐即开始，正文结束提交不足一段的剩余标记。分析并发为1时依次处理，NAI拿到tags后独立出图；正文结束显示已完成图片和在途位置，后到图片继续原位补齐。

A～B由正文模型在范围内选择实际数量，插件限制上限并按需补足下限；想固定10张可设A=B=10。世界书的“每多少字一标记”是分布建议，数量范围优先。发送前补充本轮数量约束，原世界书文件和密度仍按已有编辑/同步流程处理。

共享检查在每批目标内统一完成，各图构图、人物条目和自检完整保留。文末补图等当前tags分析收尾，遵守分析并发，复用已确认人物档案。沿用0.4.2已验证的图片原位更新流程。

[修改与数量规则说明](https://github.com/stilljy-commits/ST-BaiBai-Image/blob/codex/stream-rebuild/RELEASE-0.4.3.md)。

验证：69个测试文件，885项通过、3项原有跳过；类型检查与生产构建通过。本次未主动调用真实tags API或NAI，首张与整楼耗时需更新后实测。

main是酒馆发布文件；完整源码在codex/stream-rebuild。源码提交：[6a3dfcfe32e31a6f0485b585570a77f64400386a](https://github.com/stilljy-commits/ST-BaiBai-Image/commit/6a3dfcfe32e31a6f0485b585570a77f64400386a)。

原作者及上游：[baibai-git/ST-BaiBai-Image](https://github.com/baibai-git/ST-BaiBai-Image)。
