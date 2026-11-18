import { expect, it } from 'vitest';
import { recordStreamDiagnostic, streamDiagnosticReport } from './diagnostics';

it('keeps bounded timing diagnostics without request payloads or story content',()=>{
  recordStreamDiagnostic('GENERATION_STARTED',{at:100,options:{key:'secret-key'},chatId:'private-chat',text:'private-story'});
  recordStreamDiagnostic('stream:input-first-text',{source:'response',chars:100});
  let result=streamDiagnosticReport();
  expect(result).toContain('stream:input-first-text');
  expect(result).not.toMatch(/secret-key|private-story|private-chat/);
  for(let i=0;i<250;i++)recordStreamDiagnostic('stream:visibility',{hidden:false});
  expect(JSON.parse(streamDiagnosticReport()).events).toHaveLength(200);
});
