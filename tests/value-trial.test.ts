import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {CONFIG} from "../src/config.js";
import {enrichCompetitionAt} from "../src/metrics/calculator.js";
import {gradeRaffle, gradeHighChanceRaffle} from "../src/metrics/decision.js";
import {processEntryCandidates, preReviewPrizeValues} from "../src/alerts/buy-review.js";
import {formatTelegramOpportunityMessage} from "../src/alerts/telegram.js";
import {useDatabaseForTests, closeDatabaseForTests, getCachedAlertReview, recordAlertDecision, getCompetition, upsertCompetition} from "../src/storage/database.js";
import type {RawCompetition} from "../src/types.js";
import type {TrendAnalysis} from "../src/metrics/trends.js";

const now = new Date("2026-10-26T12:00:00Z");
function raw(overrides: Partial<RawCompetition> = {}): RawCompetition {
  return {sourceId:"trial",siteName:"example",url:"https://example.test/trial",name:"Headphones",entryPrice:1,ticketsSold:40,maxTickets:1000,maxEntriesPerUser:50,maxEntriesPerUserSource:"site",inventorySource:"exact",cashAlternative:200,valuationSource:"cash",valuationConfidence:"high",drawDate:"2026-10-26T12:45:00Z",isAutoDraw:false,categories:[],scrapedAt:now.toISOString(),...overrides};
}
const trend: TrendAnalysis = {velocityPerHour:0,estimatedSelloutMs:null,isAccelerating:false,projectedSellThrough:.06,projectedTicketsSold:60,dataPoints:3,isReliable:true,resetDetected:false};

test("live value category uses its own budget and preserves the high-chance policy", () => {
  const comp=enrichCompetitionAt(raw(),now);
  const filters={...CONFIG.filters};
  const value=gradeRaffle(comp,trend);
  assert.equal(gradeHighChanceRaffle(comp,trend).stars,0);
  assert.equal(value.stars,1);
  assert.equal(value.category,"value");
  assert.equal(value.currentScenario.cost,20);
  assert.equal(value.projectedScenario?.winProbability,.25);
  assert.ok(Object.isFrozen(value));
  assert.deepEqual(CONFIG.filters,filters);
  assert.equal(gradeRaffle(comp,null).stars,0);
  assert.equal(gradeRaffle(enrichCompetitionAt(raw({maxEntriesPerUserSource:"fallback"}),now),trend).stars,0);
  assert.equal(gradeRaffle(enrichCompetitionAt(raw({prizePayout:{kind:"conditional",terms:"50% revenue if reserve fails"}}),now),trend).stars,0);
});

test("live value cash entries send with their applied budget and full evidence", async () => {
  const comp=enrichCompetitionAt(raw({prizeDescription:"Identified model",prizeEvidence:"Operator description",drawUsesFullTicketRange:false}),now);
  let sends=0,reviews=0;
  const records=await processEntryCandidates([comp],{now:()=>now,analyzeTrend:()=>trend,recordDecision:()=>{},appendDecision:()=>{},getCachedReview:()=>null,availability:()=>"ready",
    reviewer:async()=>{reviews++;return {decision:"approve",reason:"test"};},sender:async()=>{sends++;return "sent";}});
  assert.equal(records[0]?.recommendation?.category,"value");
  assert.equal(records[0]?.outcome,"sent");
  assert.deepEqual(records[0]?.policy,{...CONFIG.filters,...CONFIG.valueOpportunities});
  assert.equal(sends,1);assert.equal(reviews,0);
  assert.equal(records[0]?.candidate?.prizeDescription,"Identified model");
  assert.equal(records[0]?.candidate?.drawUsesFullTicketRange,false);
  assert.deepEqual(records[0]?.candidate?.categories,[]);
  const message=formatTelegramOpportunityMessage(comp,gradeRaffle(comp,trend));
  assert.match(message,/Value entry/);
  assert.match(message,/£20.00 total/);
  assert.match(message,/25.0% projected win chance/);
  assert.match(message,/75.0% projected loss chance/);
});

test("live value entries enforce probability, return, full-range and operator limits", () => {
  const comp=enrichCompetitionAt(raw({cashAlternative:600}),now);
  const boundary={...trend,projectedTicketsSold:380,projectedSellThrough:.38};
  const rec=gradeRaffle(comp,boundary);
  assert.equal(rec.category,"value");
  assert.equal(rec.projectedScenario?.winProbability,.05);
  assert.equal(rec.projectedScenario?.returnRatio,.5);
  assert.equal(gradeRaffle(comp,{...boundary,projectedTicketsSold:381,projectedSellThrough:.381}).stars,0);
  assert.equal(gradeRaffle({...comp,cashAlternative:599},boundary).stars,0);
  assert.equal(gradeRaffle({...comp,maxEntriesPerUser:19},boundary).stars,0);
  assert.equal(gradeRaffle({...comp,drawUsesFullTicketRange:true},trend).stars,0);
  assert.equal(gradeRaffle({...comp,inventorySource:"estimated"},trend).stars,0);
  const fullSellThrough=gradeRaffle({...comp,maxTickets:400,maxEntriesPerUser:20},null);
  assert.equal(fullSellThrough.category,"value");
  assert.equal(fullSellThrough.projectedScenario?.winProbability,.05);
});

test("high-chance entries keep priority and value entries can be disabled", () => {
  const comp=enrichCompetitionAt(raw(),now);
  const high=gradeRaffle({...comp,ticketsSold:1},{...trend,projectedTicketsSold:1});
  assert.ok(high.stars>1);
  assert.notEqual(high.category,"value");
  const enabled=CONFIG.valueOpportunities.enabled;
  try {
    CONFIG.valueOpportunities.enabled=false;
    assert.equal(gradeRaffle(comp,trend).stars,0);
  } finally { CONFIG.valueOpportunities.enabled=enabled; }
});

test("live value prizes require approval and fresh inventory at dispatch", async () => {
  const comp=enrichCompetitionAt(raw({cashAlternative:null,estimatedPrizeValue:200,valuationSource:"site_estimate",prizeDescription:"Model X"}),now);
  for (const decision of ["approve","reject","uncertain","error"] as const) {
    let sends=0,reviews=0;
    const records=await processEntryCandidates([comp],{now:()=>now,analyzeTrend:()=>trend,recordDecision:()=>{},appendDecision:()=>{},getCachedReview:()=>null,availability:()=>"ready",
      reviewer:async()=>{reviews++;return {decision,reason:"test"};},sender:async()=>{sends++;return "sent";}});
    assert.equal(reviews,1);
    assert.equal(sends,decision==="approve"?1:0);
    assert.equal(records[0]?.outcome,decision==="approve"?"sent":"suppressed_reviewer");
  }
  let clock=now, sends=0;
  const records=await processEntryCandidates([comp],{now:()=>clock,analyzeTrend:()=>trend,recordDecision:()=>{},appendDecision:()=>{},getCachedReview:()=>null,availability:()=>"ready",
    reviewer:async()=>{clock=new Date(now.getTime()+CONFIG.filters.maxEntryInventoryAgeMs+1);return {decision:"approve",reason:"test"};},sender:async()=>{sends++;return "sent";}});
  assert.equal(sends,0);
  assert.equal(records[0]?.outcome,"suppressed_stale_inventory");
});

test("prize evidence persists and pre-review is reused when inventory changes", async () => {
  useDatabaseForTests(join(mkdtempSync(join(tmpdir(),"raffle-trial-")),"test.db"));
  try {
    const start=new Date();
    const candidate=raw({cashAlternative:null,estimatedPrizeValue:200,valuationSource:"site_estimate",prizeDescription:"Headphones model X",prizeEvidence:"Public model X specification",drawDate:new Date(start.getTime()+2*3600000).toISOString(),scrapedAt:start.toISOString()});
    upsertCompetition(candidate);
    assert.equal(getCompetition(candidate.sourceId,candidate.siteName)?.prizeDescription,candidate.prizeDescription);
    let reviews=0;
    const reviewer=async()=>{reviews++;return {decision:"approve" as const,reason:"Model and value match"};};
    await preReviewPrizeValues([enrichCompetitionAt(candidate,start)],()=>trend,reviewer,start);
    assert.equal(reviews,1);
    const later=new Date(start.getTime()+90*60000);
    const comp=enrichCompetitionAt({...candidate,ticketsSold:1,scrapedAt:later.toISOString()},later);
    const quiet={...trend,projectedTicketsSold:1,projectedSellThrough:.001};
    const dependencies={now:()=>later,analyzeTrend:()=>quiet,reviewer,availability:()=>"ready" as const,sender:async()=>"sent" as const,appendDecision:()=>{}};
    const sent=await processEntryCandidates([comp],dependencies);
    assert.equal(sent[0]?.outcome,"sent");assert.equal(reviews,1);
    await processEntryCandidates([{...comp,prizeDescription:"Different model"}],dependencies);
    assert.equal(reviews,2);
  } finally {closeDatabaseForTests();}
});

test("uncertain reviews expire quickly and a newer veto cannot reuse an old approval", () => {
  useDatabaseForTests(join(mkdtempSync(join(tmpdir(),"raffle-review-cache-")),"test.db"));
  try {
    recordAlertDecision({inputHash:"x",decision:"approve",outcome:"valuation_review",recordedAt:now.toISOString()});
    recordAlertDecision({inputHash:"x",decision:"uncertain",outcome:"valuation_review",recordedAt:new Date(now.getTime()+1000).toISOString()});
    assert.equal(getCachedAlertReview("x",3600000,new Date(now.getTime()+2000),300000)?.decision,"uncertain");
    assert.equal(getCachedAlertReview("x",3600000,new Date(now.getTime()+600000),300000),null);
  } finally {closeDatabaseForTests();}
});
