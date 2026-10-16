# 柏宝绘 · 流式重构版 0.4.12

安装／更新链接：https://github.com/stilljy-commits/ST-BaiBai-Image

新增“极速模式”，与原有标准、简单模式独立切换；升级保留原选择。极速模式由AI给出简短逐格分镜，插件补齐固定外貌与NAI格式，复用已确认状态，每页就绪即可进入生图队列；局部失败只恢复尚未接受的页。

极速模式提供按模型适配的“跟随渠道／低推理／关闭推理”，默认跟随渠道，按副API连接与模型保存，不改主API或全局渠道设置。关闭推理可能影响复杂情节理解；标准和简单继续沿用渠道设置。

修复Vertex副API只能读取主API当前模型的问题：现在可从宿主Vertex模型及自定义模型列表中独立选择，也可直接输入。列表按副API自己的完整／快速认证模式筛选；选择与请求不会切换主API。模型账号与地区支持情况以连通性测试为准。

删除世界书数量同步设置及自动写入，继续使用配图规则自动注入。已有世界书内容不改写；剧情世界书读取保留。每批分析图片数沿用可调设置。

验证：78个测试文件，1042项通过、3项跳过；类型检查和构建通过。32组标准／简单配置与0.4.11逐字比较，请求一致。普通旅行素材的新引擎三页实测：DeepSeek跟随渠道32.7秒、关闭推理4.1秒；短样本不能推算长聊天或整轮生图的加速比例。未主动进行真实Vertex或NAI出图测试，实际效果需体验。

[完整版本说明](https://github.com/stilljy-commits/ST-BaiBai-Image/blob/codex/stream-rebuild/RELEASE-0.4.12.md)。main存放酒馆发布文件，完整源码在codex/stream-rebuild。源码提交：[8fafa3b80f45be395c002322583a82a5fa4dacb6](https://github.com/stilljy-commits/ST-BaiBai-Image/commit/8fafa3b80f45be395c002322583a82a5fa4dacb6)。

原作者及上游：[baibai-git/ST-BaiBai-Image](https://github.com/baibai-git/ST-BaiBai-Image)。
