import { prepareTargetText, type PreparedTargetText } from '@/autoTag/clean';
import type { ImagePlan } from '@/autoTag/protocol';
import type { StreamJob } from '@/autoTag/streamCore';

/** Renumber positions across targets while keeping every source line and its owner. */
export function prepareStreamBatch(jobs: Pick<StreamJob<unknown, unknown>, 'id' | 'input'>[], stripTags: string[]) {
  const owners = new Map<string, string>();
  const markerTargets = new Map<string, { position: string; positions: string[] }>();
  const groups: { jobId: string; markerId: string; intent: string; positions: string[] }[] = [];
  const segments: PreparedTargetText['segments'] = [];
  for (const job of jobs) {
    const target = prepareTargetText(job.input.text || job.input.intent, stripTags);
    const positions: string[] = [];
    for (const segment of target.segments) {
      const id = `P${segments.length + 1}`;
      segments.push({ ...segment, id, sourceLine: segment.sourceLine + job.input.sourceLine });
      owners.set(id, job.id); positions.push(id);
    }
    if (!positions.length) throw new Error('标记所属正文没有可分析的位置');
    const markerId = `M${groups.length + 1}`;
    groups.push({ jobId: job.id, markerId, intent: job.input.intent, positions });
    markerTargets.set(markerId, { position: positions.at(-1)!, positions });
  }
  const target: PreparedTargetText = { segments, promptText: segments.map(segment => `${segment.text} ⟦${segment.id}⟧`).join('\n\n') };
  const instructions = `本次为 ${groups.length} 个独立配图标记分别规划图片。每个标记恰好一张，不能把不同标记合并成一张图或漫画页，也不能遗漏、重复任一标记。每张完整遵守全部生图规范。共享检查（事实与连续状态、角色清点与建档、服装时间线、时代与世界观）覆盖本请求全部目标段落，只统一执行一次；每个标记分别完成事件、页面布局、逐格动作、人物条目和全部逐图自检，不重复整套共享判断。已确认的共享事实复用结论；保留必要复核与纠错，不反复整串预写、抄写 Base 或人物 tag 草稿。漫画模式下一张是一整页，格数按漫画规范决定。images[].position 直接照抄所属标记的 M 编号，插件负责插入位置，不再挑选或比较正文 P 编号；输出顺序不限。正文 P 编号仅供 changes 的变化时序使用。如同一标记段内发生永久外貌变化且画面时点早于段末，才额外用 statePosition 指明该画面对应的 P 编号；其余图片省略该字段。\n` +
    groups.map(group => `标记 ${group.markerId}：「${group.intent}」；对应正文：${group.positions.join('、')}；图片 position 固定填 "${group.markerId}"。`).join('\n');
  return { target, owners, groups, markerTargets, instructions };
}

/** A valid image count alone is insufficient: each individual marker must be covered. */
export function splitStreamBatch(plan: ImagePlan, batch: ReturnType<typeof prepareStreamBatch>): ImagePlan['images'] {
  const images = new Map<string, ImagePlan['images'][number]>();
  for (const image of plan.images) {
    const owner = batch.owners.get(image.position);
    if (!owner || images.has(owner)) throw new Error('批量分析重复或错配了标记位置');
    images.set(owner, image);
  }
  return batch.groups.map(group => {
    const image = images.get(group.jobId);
    if (!image) throw new Error('批量分析遗漏了配图标记');
    return image;
  });
}
