import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { discoverBusiness, type CreateMessage } from "../src/calls/discover.js";
import type { Household } from "../src/household.js";

const HOUSEHOLD: Household = {
  ownerName: "Maya",
  address: "12 Elm Street",
  city: "San Francisco",
  region: "California",
  country: "US",
  facts: []
};

function message(content: Anthropic.ContentBlock[], stopReason: Anthropic.StopReason = "end_turn"): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    container: null,
    diagnostics: null,
    stop_details: null,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 1,
      output_tokens: 1,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
      speed: null
    }
  };
}

function report(candidates: Array<{ name: string; phone: string; why: string }>): Anthropic.ContentBlock {
  return { type: "tool_use", id: "toolu_1", caller: { type: "direct" }, name: "report_candidates", input: { candidates } };
}

describe("discoverBusiness", () => {
  it("keeps parseable phone numbers and drops the rest", async () => {
    const create: CreateMessage = async () => message([
      { type: "text", text: "Searching for plumbers.", citations: null },
      report([
        { name: "Joe's Plumbing", phone: "+1 415 555 0134", why: "Rated for same-week visits" },
        { name: "Mystery Pipes", phone: "call us!", why: "No listed number" }
      ])
    ]);
    const candidates = await discoverBusiness(create, "find a plumber for tomorrow", HOUSEHOLD);
    expect(candidates).toEqual([{ name: "Joe's Plumbing", phone: "+14155550134", why: "Rated for same-week visits" }]);
  });

  it("returns no candidates when the web search result is an error object", async () => {
    const create: CreateMessage = async () => message([
      {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_1",
        caller: { type: "direct" },
        content: { type: "web_search_tool_result_error", error_code: "unavailable" }
      }
    ]);
    expect(await discoverBusiness(create, "find a plumber for tomorrow", HOUSEHOLD)).toEqual([]);
  });

  it("resends after a pause_turn until report_candidates arrives", async () => {
    let calls = 0;
    const create: CreateMessage = async () => {
      calls += 1;
      if (calls === 1) return message([{ type: "text", text: "Still searching.", citations: null }], "pause_turn");
      return message([report([{ name: "Roto Ruth", phone: "4155550177", why: "Open weekends" }])]);
    };
    const candidates = await discoverBusiness(create, "find a plumber for tomorrow", HOUSEHOLD);
    expect(calls).toBe(2);
    expect(candidates).toEqual([{ name: "Roto Ruth", phone: "+14155550177", why: "Open weekends" }]);
  });
});
