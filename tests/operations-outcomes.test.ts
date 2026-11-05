import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {useDatabaseForTests,closeDatabaseForTests,getDb,recordAlertDecision} from "../src/storage/database.js";
import {recordMonitorHeartbeat,getMonitorStatus,recordMonitorScan} from "../src/monitor/heartbeat.js";
import {recordActualEntry,recordActualOutcome,recordActualSpend,getEntryResults,recordEntryFeedback} from "../src/storage/outcomes.js";
import {buildStatusReport} from "../src/cli/status.js";

function setup() {useDatabaseForTests(join(mkdtempSync(join(tmpdir(),"raffle-operations-")),"test.db"));}
const now = new Date("2026-10-26T12:00:00Z");
const identity={entryKey:"entry:round:raffle",canonicalUrl:"https://example.test/raffle",siteName:"example",sourceId:"raffle",raffleName:"Prize"};

test("heartbeat detects missing monitoring and persists a recovery gap once",()=>{
 setup();try {
  assert.equal(getMonitorStatus(now.getTime()).status,"unknown");
  recordMonitorHeartbeat(now,true);recordMonitorScan(now);
  assert.equal(getMonitorStatus(now.getTime()).status,"running");
  const later=new Date(now.getTime()+3600000);
  assert.equal(getMonitorStatus(later.getTime()).status,"stale");
  assert.equal(recordMonitorHeartbeat(later,true),3600000);
  recordMonitorHeartbeat(new Date(later.getTime()+60000));
  assert.equal(getDb().prepare("SELECT count(*) n FROM monitor_gaps").get()?.n,1);
 }finally{closeDatabaseForTests();}
});

test("actual spend is idempotent and returns exclude unknown stakes and pending prizes",()=>{
 setup();try {
  recordActualEntry(identity,10,now);recordActualEntry(identity,12,now);
  recordActualOutcome(identity.entryKey,"won",30,now);
  assert.equal(getEntryResults().totals.realisedNet,18);
  recordActualEntry({...identity,entryKey:"pending"},20,now);
  assert.equal(getEntryResults().totals.realisedNet,18);
  assert.equal(getEntryResults().totals.knownSpend,32);
  assert.throws(()=>recordActualOutcome(identity.entryKey,"lost",2),/zero/);
  assert.throws(()=>recordActualSpend(identity.entryKey,-1),/non-negative/);
  recordEntryFeedback({...identity,alertKey:"button-entry",chatId:"1",messageId:1,sentAt:now.toISOString(),updateId:1,classification:"won",feedbackValue:"won",source:"inline_button",actorId:null,occurredAt:now.toISOString(),receivedAt:now.toISOString(),rawJson:"{}"});
  assert.equal(getEntryResults().totals.missingSpend,1);
  assert.equal(getEntryResults().totals.fullyRecordedSettledEntries,1);
 }finally{closeDatabaseForTests();}
});

test("status counts distinct live value draws and confirmed sends separately",()=>{
 setup();try {
  const base={phase:"final",stage:"entry-window",canonicalUrl:identity.canonicalUrl,candidate:{drawDate:"2026-10-26T12:30:00Z"},recommendation:{stars:1,category:"value"},deterministicReason:"too unlikely",outcome:"suppressed_deterministic",recordedAt:now.toISOString()};
  recordAlertDecision(base);recordAlertDecision(base);
  recordAlertDecision({...base,stage:"valuation-preflight"});
  const report=buildStatusReport(now,1);
  assert.equal(report.decisions.observedDrawsInEntryWindow,1);
  assert.equal(report.decisions.valueQualifiedDraws,1);
  assert.equal(report.decisions.confirmedDelivery?.draws,0);
  assert.equal(report.decisions.lastReasonPerDraw['too unlikely'],1);
 }finally{closeDatabaseForTests();}
});
