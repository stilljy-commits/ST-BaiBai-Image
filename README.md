# 柏宝绘 · 流式重构版 0.4.11

安装/更新链接：https://github.com/stilljy-commits/ST-BaiBai-Image

新增 Google Vertex AI 副 API，支持完整版 Service Account 与快速版 Express，使用酒馆/TT 已保存的对应凭据。插件「副 API → 新建渠道 → 接口类型」选择 Google Vertex AI，填写模型与认证模式；也可读取 TT 当前 Vertex 的公开连接设置。副 API 独立运行，不切换正文连接。Express 是认证模式，不承诺更快。

新增「每批分析图片数」：1～50，默认3。与分析并发、NAI出图并发分别设置；设为5时，13张图按5＋5＋3分析。正文结束立即处理余数，修改从下一轮生效。修复字数统计和信息小结后误出尾图的问题，统计文字保留。

简单/标准模式及现有模型、思考档位沿用。研究中的 tags 核心重构尚未加入。验证：75个测试文件，1004项通过、3项原有跳过；类型检查、构建通过。未主动调用真实Vertex/NAI，实际速度需对照测试。

[完整版本说明](https://github.com/stilljy-commits/ST-BaiBai-Image/blob/codex/stream-rebuild/RELEASE-0.4.11.md)。main存放酒馆发布文件，完整源码在codex/stream-rebuild。源码提交：[5294df91acbfba2f72fb14263e1137899c374ecb](https://github.com/stilljy-commits/ST-BaiBai-Image/commit/5294df91acbfba2f72fb14263e1137899c374ecb)。

原作者及上游：[baibai-git/ST-BaiBai-Image](https://github.com/baibai-git/ST-BaiBai-Image)。
