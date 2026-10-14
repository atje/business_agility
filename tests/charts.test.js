import { describe, expect, it } from "vitest";
import { groupTimingRecords } from "../web/charts.js";

describe("groupTimingRecords", () => {
  it("groups records by one-decimal lead time and processing ratio", () => {
    const records = [
      { id: 1, completed: true, leadTime: 2.04, processingTime: 1.02 },
      { id: 2, completed: false, startTime: 3, processingTime: 1.04 },
    ];

    expect(groupTimingRecords(records, 5.04)).toEqual([
      {
        leadTime: 2,
        processingRatio: 0.5,
        count: 2,
        completedCount: 1,
      },
    ]);
  });

  it("uses a zero ratio when a work item has no elapsed lead time", () => {
    expect(groupTimingRecords([
      { id: 1, completed: false, startTime: 5, processingTime: 1 },
    ], 5)).toEqual([
      {
        leadTime: 0,
        processingRatio: 0,
        count: 1,
        completedCount: 0,
      },
    ]);
  });
});
