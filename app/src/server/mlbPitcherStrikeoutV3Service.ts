import { MlbPitcherKShadowResultV3, NormalizedPlayerPropQuote } from '../types';
import { buildMlbPitcherKFeatureVectorV3 } from './mlbPitcherKFeatureService';
import { evaluateMlbPitcherKNegativeBinomial } from './mlbPitcherKNegativeBinomialService';
import { mlbPitcherKBoostedShadowService } from './mlbPitcherKBoostedShadowService';

function round6(x: number | null): number | null {
  return x === null || !Number.isFinite(x) ? null : Number(x.toFixed(6));
}

export class MlbPitcherStrikeoutV3Service {
  evaluateShadow(
    quote: NormalizedPlayerPropQuote,
    productionModelVersion: string,
    productionOverProbability: number | null,
    asOf: Date = new Date()
  ): MlbPitcherKShadowResultV3 {
    const featureVector = buildMlbPitcherKFeatureVectorV3(quote, asOf);
    const negativeBinomial = evaluateMlbPitcherKNegativeBinomial(featureVector);
    const nbOver = negativeBinomial.overProbability;
    const nbUnder = negativeBinomial.underProbability;
    const push = negativeBinomial.pushProbability;
    const nonPushMass = nbOver !== null && nbUnder !== null ? nbOver + nbUnder : null;
    const conditionalBaseOver = nbOver !== null && nonPushMass !== null && nonPushMass > 0 ? nbOver / nonPushMass : null;
    const boosted = conditionalBaseOver !== null
      ? mlbPitcherKBoostedShadowService.evaluate(featureVector, conditionalBaseOver, asOf)
      : {
          modelVersion: 'APEX_MLB_K_GB_STUMPS_V3' as const,
          probabilityBasis: 'OVER_GIVEN_NO_PUSH' as const,
          status: 'INSUFFICIENT_EVIDENCE' as const,
          probability: null,
          validation: {
            trainingRows: 0,
            validationRows: 0,
            baselineLogLoss: null,
            boostedLogLoss: null,
            baselineBrier: null,
            boostedBrier: null,
            trainEndAt: null,
            validationStartAt: null,
          },
          reason: 'Negative-Binomial V3 foundation unavailable',
        };

    // A boosted model is allowed to supersede NB only inside the SHADOW output and only after
    // chronological held-out validation. Production APEX_BASELINE_V1 remains untouched.
    const shadowOver = boosted.status === 'ACTIVE_SHADOW' && boosted.probability !== null && push !== null
      ? boosted.probability * (1 - push)
      : nbOver;
    const shadowUnder = boosted.status === 'ACTIVE_SHADOW' && boosted.probability !== null && push !== null
      ? (1 - boosted.probability) * (1 - push)
      : nbUnder;
    const divergence = shadowOver !== null && productionOverProbability !== null
      ? shadowOver - productionOverProbability
      : null;

    const promotionEligible =
      boosted.status === 'ACTIVE_SHADOW' &&
      featureVector.dataQuality === 'ENRICHED' &&
      featureVector.officialBattersFacedStarts >= 5 &&
      boosted.validation.validationRows >= 20 &&
      boosted.validation.boostedLogLoss !== null &&
      boosted.validation.baselineLogLoss !== null &&
      boosted.validation.boostedLogLoss < boosted.validation.baselineLogLoss;

    return Object.freeze({
      shadowVersion: 'APEX_PITCHER_K_V3_SHADOW',
      evaluatedAt: asOf.toISOString(),
      productionModelVersion,
      productionOverProbability: round6(productionOverProbability),
      featureVector: Object.freeze({ ...featureVector, reasonCodes: Object.freeze([...featureVector.reasonCodes]) as unknown as string[] }),
      negativeBinomial: Object.freeze({ ...negativeBinomial }),
      boosted: Object.freeze({ ...boosted, validation: Object.freeze({ ...boosted.validation }) }),
      shadowOverProbability: round6(shadowOver),
      shadowUnderProbability: round6(shadowUnder),
      shadowPushProbability: round6(push),
      divergenceFromProduction: round6(divergence),
      promotionEligible,
      promotionReason: promotionEligible
        ? 'Eligible for continued shadow review: boosted challenger beat V3 NB on chronological holdout with enriched features. Production promotion is not automatic.'
        : boosted.status === 'INSUFFICIENT_EVIDENCE'
          ? boosted.reason
          : featureVector.officialBattersFacedStarts < 5
            ? 'Not promotion eligible: at least five official MLB batters-faced workload starts are required.'
            : featureVector.dataQuality !== 'ENRICHED'
              ? 'Not promotion eligible: advanced public-data feature coverage is not yet enriched.'
              : 'Not promotion eligible: challenger has not earned sufficient chronological validation improvement.',
    });
  }
}

export const mlbPitcherStrikeoutV3Service = new MlbPitcherStrikeoutV3Service();
