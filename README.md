# 柏宝绘 · 流式重构版 0.4.13

安装／更新链接：https://github.com/stilljy-commits/ST-BaiBai-Image

新增可选开关“正文生成时显示已完成图片”，位于设置 → 自动生成 tag，默认关闭，需要开启流式出图。标准、简单、极速模式均可使用，原有选择保留。

已完成图片提前显示在对应段落，未完成图片不增加占位；正文结束后沿用正式插入、保存和重试流程。只复用已有任务结果，不增加分析或生图请求。已经在正文显示的图不重复进入浮层，点击可放大。

正文刷新时复用已加载图片节点；上滑阅读时保留阅读段落，停留底部时继续跟随。切换聊天、回答、删除消息、停止或关闭开关时清理。位置无法确认或显示异常时回退到原流程，不影响图片任务。

验证：79个测试文件，1056项通过、3项原有跳过；类型检查及生产构建通过。Chrome、Edge各17项浏览器场景通过，覆盖60次连续重绘、增量修改、滚动、手机宽度、正式接管和异常回退，测试中的阅读位置偏移为0。本轮未调用真实模型或NAI，也没有安装替换用户TT；各主题与正则组合仍以实际体验为准。

[完整版本说明](https://github.com/stilljy-commits/ST-BaiBai-Image/blob/codex/stream-rebuild/RELEASE-0.4.13.md)。main存放酒馆发布文件，源码在codex/stream-rebuild。源码提交：[d53eac890cb819df5f9012f29102026ebd39b1f4](https://github.com/stilljy-commits/ST-BaiBai-Image/commit/d53eac890cb819df5f9012f29102026ebd39b1f4)。

原作者及上游：[baibai-git/ST-BaiBai-Image](https://github.com/baibai-git/ST-BaiBai-Image)。
