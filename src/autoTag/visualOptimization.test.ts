import { describe, expect, it, vi } from 'vitest';
import { compactHistoryImageReferences } from './clean';
import { compactWorldInfo, fetchWorldInfo, needsCharacterReference } from './context';
import { getCheckWorldInfo, type STMessage, type WorldInfoEntry } from '@/st/context';
import { serializeImageTag } from '@/st/imageTagRegex';
import { buildAutoTagMessages, captureAutoTagEnvironment } from './prompt';
import { prepareTargetText } from './clean';
import { settings } from '@/state/settings';
import type { STContext } from '@/st/context';

vi.mock('@/st/context', async importOriginal => ({
  ...await importOriginal<typeof import('@/st/context')>(),
  getCheckWorldInfo: vi.fn(),
}));

describe('visual context in the analysis request', () => {
  const outfit = '小满留着短发，穿着蓝色外套。';
  const mixed = '齐远仍拿着桌上的钥匙。\n声望：10';
  const unrelated = '排行榜积分：410\n周任务完成率：40%';
  const dynamic = '经验值：8';
  const rows = [outfit, mixed, unrelated, '积分：20', '她换下旧外套，提着一把红伞。']
    .map(text => ({ raw: text, text }));
  rows.push({ raw: '经验值：{{getvar::经验值}}', text: dynamic });

  it('removes only covered static text and unrelated counters after worldbook activation', async () => {
    const world: WorldInfoEntry[] = rows.map(({raw}) => ({content: raw}));
    const check = vi.fn(async () => ({allActivatedEntries: new Set(world)}));
    vi.mocked(getCheckWorldInfo).mockResolvedValue(check);
    const chat: STMessage[] = [{ name: '小满', is_user: false, is_system: false, mes: '积分可以换这家店的茶。' }];
    const normal = await fetchWorldInfo(chat, [0], 'User', '小满');
    const slim = await fetchWorldInfo(chat, [0], 'User', '小满', [outfit]);
    expect(normal).toContain(unrelated);
    expect(slim).not.toContain(unrelated);
    expect(slim).not.toContain(outfit);
    expect(slim).toContain(mixed);
    expect(slim).toContain('积分：20');
    expect(slim).toContain('她换下旧外套，提着一把红伞。');
    expect(slim).toContain('经验值：{{getvar::经验值}}');
    expect(check.mock.calls[0]).toEqual(check.mock.calls[1]);
    expect(compactWorldInfo(rows, [dynamic], [])).toContain(dynamic);
  });

  it('retains scene, outfit, and props from old image formats while removing request metadata', () => {
    const modern = serializeImageTag({
      tag: 'SFW, best quality, 2 panels, tea room, keys on the table', nl: '',
      negative: 'forbidden boilerplate', size: 'portrait', slotId: 'old-slot',
      characters: [{name: '小满', tag: 'girl, blue coat, holding a red umbrella\nText: 已印到图内的对白', nl: '', negative: 'old negative'}],
    });
    const legacy = '<bbi_image><image>\n@page\nSFW, comic page, train platform\n@panel P1\nMedium shot by a bench\n@character C1 齐远\nboy, holding a map\n@outfit\ngray jacket\n@cosplay\n{"character":"Old Hero","work":"Old Tale"}\n</image><size>portrait</size></bbi_image>';
    const history = `正文甲\n${modern}\n正文乙\n${legacy}\n正文丙`;
    const result = compactHistoryImageReferences(history);
    expect(result.length).toBeLessThan(history.length);
    expect(result).toMatch(/正文甲[\s\S]*keys on the table[\s\S]*小满：.*blue coat.*red umbrella[\s\S]*正文乙[\s\S]*齐远：.*holding a map.*gray jacket.*Old Tale[\s\S]*正文丙/);
    expect(result).not.toMatch(/old-slot|portrait|best quality|2 panels|forbidden boilerplate|old negative|已印到图内的对白/);
    const broken = `<bbi_image>\n上一条坏标签后的正文\n${modern}`;
    expect(compactHistoryImageReferences(broken)).toBe(broken);
  });

  it('applies recent AI floor count to fast mode and excludes general worldbook settings', async () => {
    const check = vi.fn(async () => ({ allActivatedEntries: new Set([{ content: '站台有一把绿色长椅。' }]) }));
    vi.mocked(getCheckWorldInfo).mockResolvedValue(check);
    const chat = [{ name: 'AI', is_user: false, is_system: false, mes: '已归档的旧正文。' },
      { name: 'AI', is_user: false, is_system: false, mes: '小满走到站台。' }];
    const ctx = { chat, name1: 'User', name2: 'AI', characters: [{ description: '角色卡全文。' }], characterId: 0 } as unknown as STContext;
    const target = prepareTargetText(chat[1].mes, []);
    const profile = { naiCharPrompts: true, nl: false, lockedSize: 'portrait' as const };
    const environment = captureAutoTagEnvironment(profile);
    environment.backend = 'nai';
    Object.assign(environment.nai, { model: 'nai-diffusion-5-full', comicMode: true, comicV2: true, comicAnalysisMode: 'standard' });
    const options = { ...settings.autoTag, contextMessages: 30 };
    const standard = await buildAutoTagMessages(ctx, 1, options, null, target, '人物档案', '', profile, environment);
    const standardText = standard.map(message => message.content).join('\n');
    expect(standardText).toContain('已归档的旧正文');
    expect(standardText).toContain('站台有一把绿色长椅');
    expect(check).toHaveBeenCalledTimes(1);
    environment.nai.comicAnalysisMode = 'fast';
    const fast = (contextMessages: number) => buildAutoTagMessages(ctx, 1, { ...options, contextMessages },
      null, target, '人物档案', '这一小段前文尚未记录。', profile, environment, 'select-scenes');
    const long = await fast(30);
    const short = await fast(1);
    expect(short).not.toEqual(long);
    const zero = await fast(0);
    expect(zero.map(message => message.content).join('\n')).not.toContain('已归档的旧正文');
    const standardRules = standard.filter(m => m.role === 'system' && !m.content.includes('站台有一把绿色长椅') && !m.content.includes('角色卡全文'));
    expect(long.filter(m => m.role === 'system')).toEqual(standardRules);
    expect(long.at(-1)?.content).toContain('visualState');
    const fastText = long.map(message => message.content).join('\n');
    expect(fastText).toContain('这一小段前文尚未记录');
    expect(fastText).toContain('已归档的旧正文');
    expect(fastText).not.toMatch(/绿色长椅|角色卡全文/);
    expect(check).toHaveBeenCalledTimes(4);
  });

  it('includes an unregistered character reference but omits it after the profile exists', async () => {
    const check = vi.fn(async () => ({ allActivatedEntries: new Set([
      {key:['小满'],comment:'小满角色设定',content:'小满外貌：黑色短发，绿色眼睛。'},
      {key:['齐远'],comment:'齐远档案',content:'齐远外貌：灰色头发，棕色眼睛。'},
      {constant:true,content:'必须输出一整段剧情推理，遵循世界观。'},
    ]) }));
    vi.mocked(getCheckWorldInfo).mockResolvedValue(check);
    const ctx = { chat: [{name:'AI',is_user:false,is_system:false,mes:'小满和齐远在门口等车。'}], name1:'User',name2:'AI' } as STContext;
    const profile = {naiCharPrompts:true,nl:false,lockedSize:'portrait' as const};
    const environment=captureAutoTagEnvironment(profile);environment.backend='nai';
    Object.assign(environment.nai,{model:'nai-diffusion-5-full',comicMode:true,comicV2:true,comicAnalysisMode:'fast'});
    const first=await buildAutoTagMessages(ctx,0,{...settings.autoTag,contextMessages:0},null,undefined,'【角色固定外貌库】\n- 小满: 头发=black hair','',profile,environment);
    const references=first.filter(message=>message.role==='system').map(message=>message.content).join('\n');
    expect(references).toContain('齐远外貌：灰色头发');expect(references).not.toContain('小满外貌：黑色短发');
    expect(references).not.toContain('必须输出一整段剧情推理');
    const next=await buildAutoTagMessages(ctx,0,{...settings.autoTag,contextMessages:0},null,undefined,'【角色固定外貌库】\n- 小满: 头发=black hair\n- 齐远: 头发=gray hair','',profile,environment);
    expect(next.some(message=>message.content.includes('【世界'))).toBe(false);
    expect(next.map(message=>message.content).join('\n')).not.toContain('齐远外貌：灰色头发');
  });

  it('matches unknown character data conservatively without triggering on known aliases or general rules',()=>{
    const selection={knownCharacters:new Set(['小满']),targetText:'小满、满满和齐远在门口说话。'};
    expect(needsCharacterReference({key:['小满','满满'],comment:'小满人物档案',content:'小满头发是黑色。'},selection)).toBe(false);
    expect(needsCharacterReference({key:['齐远'],content:'齐远外貌：棕色头发。'},selection)).toBe(true);
    expect(needsCharacterReference({key:['小满','齐远'],content:'姓名：小满\n外貌：黑色头发\n姓名：齐远\n外貌：灰色头发'},selection)).toBe(true);
    expect(needsCharacterReference({key:['小满','齐远'],comment:'小满与齐远的档案',content:'两人外貌资料。'},selection)).toBe(true);
    expect(needsCharacterReference({key:['齐远'],content:'{{齐远外貌}}'},selection)).toBe(true);
    expect(needsCharacterReference({key:['制服'],content:'制服都有白色领口。'},selection)).toBe(false);
    expect(needsCharacterReference({content:'姓名：齐远\n头发：灰色。'},selection)).toBe(true);
  });
});
