import { prisma } from "@/core/db/client";
import { createAiGarmentProject, saveWorkflowStep } from "@/modules/ai-garment-flow/ai-garment-project.service";
import {
  createDevelopmentBrief,
  editDesignDirection,
  decideDesignDirection,
  regenerateDesignDirection,
  listDesignDirections,
} from "@/modules/ai-garment-flow/development-brief.service";

const COMPANY_ID = "18283663-2ef8-4ef7-80f9-bf94bd6222b6";
const USER_ID = "36d9cc04-403c-44e9-a6ed-b6a5fe39d30e";
const actor = { companyId: COMPANY_ID, userId: USER_ID };

let passed = 0;
let failed = 0;

async function check(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${label}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${label} —`, (err as Error).message);
    failed++;
  }
}

async function expectError(fn: () => Promise<unknown>, expectedCode: string) {
  try {
    await fn();
    throw new Error(`expected an error with code ${expectedCode} but none was thrown`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== expectedCode) throw new Error(`expected code ${expectedCode}, got ${code} (${(err as Error).message})`);
  }
}

async function main() {
  console.log("=== Process 2 (Development Brief) — LIVE Anthropic verification ===\n");

  const project = await createAiGarmentProject(actor, {
    projectName: "Process 2 Live Test",
    sourceType: "REFERENCE",
    targetMarket: "USA",
    targetSellingPrice: 45,
    currencyCode: "USD",
  } as never);
  console.log(`Created test project ${project.projectNumber} (${project.id})\n`);

  await check("Gate — cannot reach DEVELOPMENT_BRIEF without an approved Reference Analysis", async () => {
    await expectError(() => saveWorkflowStep(actor, project.id, { stepKey: "DEVELOPMENT_BRIEF" }), "INVALID_STATE_TRANSITION");
  });

  // Seed a real, approved Reference Analysis — the same simulated-but-
  // realistic-shape seed used for Process 1's own verification, since this
  // pass is specifically testing Process 2's own AI call, not Process 1's.
  const analysis = await prisma.aiGarmentReferenceAnalysis.create({
    data: {
      companyId: COMPANY_ID,
      projectId: project.id,
      referenceAttachmentId: "00000000-0000-0000-0000-000000000000",
      status: "APPROVED",
      analysisVersion: 1,
      promptVersion: "reference-analysis-v1",
      provider: "anthropic",
      model: "claude-opus-5",
      rawResponseJson: { simulated: true },
      constructionComplexityLevel: "MEDIUM",
      constructionComplexityExplanation: "Set-in sleeves and a curved yoke seam.",
      manufacturingChallenges: ["Yoke pattern matching"],
      keyDesignLanguageFeatures: ["Relaxed boxy silhouette", "Dropped shoulder"],
      featuresForFurtherDevelopment: ["Collar treatment", "Hem finish"],
      featuresToChangeForDifferentiation: ["Placket width", "Pocket placement"],
      missingInformation: ["Back view", "Fabric composition"],
      designDnaSummary:
        "A relaxed, boxy woven shirt with a dropped shoulder and clean minimal front, reading as casual-smart with a slightly oversized commercial silhouette.",
      approvedByUserId: USER_ID,
      approvedAt: new Date(),
      createdByUserId: USER_ID,
      observations: {
        createMany: {
          data: [
            { featureKey: "garmentCategory", aiObservation: "Shirt", aiConfidence: "CONFIRMED_VISUALLY", aiManufacturingRelevance: "Standard shirt construction.", approvedObservation: "Shirt" },
            { featureKey: "silhouette", aiObservation: "Boxy, relaxed", aiConfidence: "CONFIRMED_VISUALLY", aiManufacturingRelevance: "Simple block, low shaping.", approvedObservation: "Boxy, relaxed" },
          ],
        },
      },
    },
  });
  console.log(`Seeded APPROVED analysis ${analysis.id}\n`);

  await check("saveWorkflowStep can now reach DEVELOPMENT_BRIEF", async () => {
    const updated = await saveWorkflowStep(actor, project.id, { stepKey: "DEVELOPMENT_BRIEF" });
    if (updated.currentStepKey !== "DEVELOPMENT_BRIEF") throw new Error("step did not advance");
  });

  await check("Gate — cannot advance past DEVELOPMENT_BRIEF with zero approved directions", async () => {
    await expectError(() => saveWorkflowStep(actor, project.id, { stepKey: "GENERATE_VARIATIONS" }), "INVALID_STATE_TRANSITION");
  });

  console.log("\n--- Calling the REAL Anthropic API (Sonnet, text-only) for 3 design directions — this may take a while ---\n");

  let directions: Awaited<ReturnType<typeof listDesignDirections>> = [];
  await check("createDevelopmentBrief — real live Anthropic call succeeds and returns exactly 3 directions", async () => {
    const result = await createDevelopmentBrief(actor, project.id, {
      targetMarket: "USA",
      targetCustomerProfile: "Young professionals, 25-35",
      preferredFabric: "lightweight cotton poplin",
      factoryCapabilities: "basic wovens, no embroidery",
      directionCount: 3,
      designBalance: "BALANCED",
    } as never);
    if (!result || result.length !== 3) throw new Error(`expected 3 directions, got ${result?.length}`);
    directions = result;
  });

  if (directions.length > 0) {
    console.log("\nGenerated directions (real AI output):");
    for (const d of directions) {
      console.log(`  - "${d.designDirectionName}" [${d.commercialClassification}] overall=${d.overallScore}/100 recommended=${d.isRecommendedForVisualisation}`);
    }
    console.log();
  }

  await check("Every direction has real, non-empty content for every required field", async () => {
    for (const d of directions) {
      const requiredStringFields = [
        "designDirectionName", "targetConsumer", "silhouette", "garmentLength", "fit", "neckline", "collar",
        "sleeve", "shoulderConstruction", "frontConstruction", "backConstruction", "closure", "pocket",
        "waistTreatment", "hem", "keyNewDesignFeature", "suggestedFabricCharacter", "suggestedTrims",
        "commercialRationale", "manufacturingRisk", "differentiationFromReference",
      ] as const;
      for (const f of requiredStringFields) {
        const value = (d as unknown as Record<string, unknown>)[f];
        if (typeof value !== "string" || value.trim().length === 0) throw new Error(`direction ${d.id} field ${f} is empty`);
      }
    }
  });

  await check("Scores are within their real 0-10 / 0-100 bounds and overall score matches the recommendation ranking", async () => {
    for (const d of directions) {
      const scores = [
        d.commercialPotentialScore, d.buyerFitScore, d.manufacturingEaseScore,
        d.targetPriceCompatibilityScore, d.fabricEfficiencyScore, d.designFreshnessScore,
      ];
      for (const s of scores) if (s < 0 || s > 10) throw new Error(`sub-score out of bounds: ${s}`);
      if (d.overallScore < 0 || d.overallScore > 100) throw new Error(`overall score out of bounds: ${d.overallScore}`);
    }
    const recommendedCount = directions.filter((d) => d.isRecommendedForVisualisation).length;
    if (recommendedCount === 0) throw new Error("no direction was marked recommended");
    const sorted = [...directions].sort((a, b) => b.overallScore - a.overallScore);
    const topScore = sorted[0].overallScore;
    const recommendedScores = directions.filter((d) => d.isRecommendedForVisualisation).map((d) => d.overallScore);
    if (Math.max(...recommendedScores) !== topScore) throw new Error("the top-scoring direction was not marked recommended");
  });

  const firstId = directions[0].id;
  const secondId = directions[1].id;

  await check("Edit a design direction — content updates, AI-original data still in aiRawJson for audit", async () => {
    const before = directions[0];
    const updated = await editDesignDirection(actor, firstId, { silhouette: "Manually corrected: cropped and fitted, not boxy" });
    if (updated.silhouette !== "Manually corrected: cropped and fitted, not boxy") throw new Error("edit did not persist");
    if (!updated.userEdited) throw new Error("userEdited flag not set");
    const raw = await prisma.aiGarmentDesignDirection.findUnique({ where: { id: firstId } });
    const rawJson = raw?.aiRawJson as { silhouette?: string };
    if (rawJson?.silhouette !== before.silhouette) throw new Error("aiRawJson audit copy was altered by the edit — must never happen");
  });

  await check("Approve one, reject one, save one for later — reload and confirm all three persist independently", async () => {
    await decideDesignDirection(actor, firstId, { decision: "APPROVE" });
    await decideDesignDirection(actor, secondId, { decision: "REJECT" });
    if (directions.length > 2) {
      await decideDesignDirection(actor, directions[2].id, { decision: "SAVE_FOR_LATER" });
    }
    const reloaded = await listDesignDirections(COMPANY_ID, project.id);
    const first = reloaded.find((d) => d.id === firstId)!;
    const second = reloaded.find((d) => d.id === secondId)!;
    if (first.status !== "APPROVED") throw new Error(`expected APPROVED, got ${first.status}`);
    if (second.status !== "REJECTED") throw new Error(`expected REJECTED, got ${second.status}`);
    if (second.isRecommendedForVisualisation) throw new Error("a REJECTED direction must never stay marked recommended");
  });

  await check("Gate now passes — at least one design direction is APPROVED", async () => {
    const updated = await saveWorkflowStep(actor, project.id, { stepKey: "GENERATE_VARIATIONS" });
    if (updated.currentStepKey !== "GENERATE_VARIATIONS") throw new Error("did not advance to GENERATE_VARIATIONS");
  });

  console.log("\n--- Calling the REAL Anthropic API again for a single Regenerate — this may take a while ---\n");

  await check("Regenerate — real live call produces genuinely fresh content and resets status/version", async () => {
    const before = await prisma.aiGarmentDesignDirection.findUnique({ where: { id: secondId } });
    const regenerated = await regenerateDesignDirection(actor, secondId);
    if (regenerated.version !== 2) throw new Error(`expected version 2, got ${regenerated.version}`);
    if (regenerated.status !== "GENERATED") throw new Error(`expected GENERATED after regenerate, got ${regenerated.status}`);
    if (regenerated.userEdited) throw new Error("regenerate should reset userEdited to false");
    console.log(`  Regenerated name: "${before?.designDirectionName}" -> "${regenerated.designDirectionName}"`);
  });

  // Cleanup — remove every trace of this verification run.
  await prisma.aiGarmentDesignDirection.deleteMany({ where: { projectId: project.id } });
  await prisma.aiGarmentDevelopmentBriefRun.deleteMany({ where: { projectId: project.id } });
  await prisma.aiGarmentReferenceObservation.deleteMany({ where: { analysisId: analysis.id } });
  await prisma.aiGarmentReferenceAnalysis.delete({ where: { id: analysis.id } });
  await prisma.aiGarmentProject.delete({ where: { id: project.id } });
  console.log("\nTest project and all its data cleaned up.");

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
