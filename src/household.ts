import { readFileSync } from "node:fs";
import { z } from "zod";

const HouseholdSchema = z.object({
  ownerName: z.string().min(1),
  address: z.string().min(1).optional(),
  maxUsdDefault: z.number().positive().optional(),
  facts: z.array(z.string().min(1)).default([])
});

export type Household = z.infer<typeof HouseholdSchema>;

export function readHousehold(file: string): Household {
  return HouseholdSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export function householdFacts(household: Household): string[] {
  return [...(household.address ? [`The address is ${household.address}`] : []), ...household.facts];
}
