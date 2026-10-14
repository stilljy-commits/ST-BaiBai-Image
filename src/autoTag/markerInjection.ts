import { getContext } from '@/st/context';
import { settings } from '@/state/settings';

const KEY = 'bbi_stream_marker_rule';
let warned = false;
export function markerRuleText(min: number, max: number): string {
  return `【正文配图标记规则】
写剧情时，在值得配图的段落之后放单独一行 [img: 一句中文画面意图]。每条意图不超过30字，不写英文tag。
本楼配图数量控制在 ${min}~${max} 张之间。数量范围优先于密度；约400~600字一个标记仅作分布指引，不得超过上限。不要把标记全部集中在开头。
标记对应一个有视觉价值的事件，可表现动作、互动、场景变化或人物状态。不得为了配图编造剧情。${min === 0 ? '没有值得绘制的事件可以不放标记。' : '在有事实依据的候选中满足最低数量。'}`;
}
export function syncMarkerInjection(): void {
  const ctx = getContext();
  const active = settings.enabled && settings.autoTag.enabled && settings.autoTag.streamGen;
  if (ctx?.setExtensionPrompt) {
    ctx.setExtensionPrompt(KEY, active ? markerRuleText(settings.autoTag.minImages, settings.autoTag.maxImages) : '', 1, 1, false, 0);
  } else if (active && !settings.autoTag.streamWorldBook?.trim() && !warned) {
    warned = true; toastr.info('当前客户端未提供标记注入接口，请配置已有的配图规则世界书；无标记时使用原版整楼分析', '柏宝绘');
  }
}
