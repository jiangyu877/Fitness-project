export type ContentReference = {
  demoOnly: boolean;
  reviewStatus: 'DEMO_UNREVIEWED' | 'REVIEW_PENDING' | 'APPROVED' | 'RETIRED';
};

export type PublicationBlocker =
  | 'PROFESSIONAL_RULES_UNAPPROVED'
  | 'DEMO_CONTENT_REFERENCED'
  | 'CONTENT_NOT_APPROVED';

export function checkPublication(input: {
  professionalRulesApproved: boolean;
  content: readonly ContentReference[];
}): { allowed: boolean; blockers: PublicationBlocker[] } {
  const blockers: PublicationBlocker[] = [];

  if (!input.professionalRulesApproved) {
    blockers.push('PROFESSIONAL_RULES_UNAPPROVED');
  }
  if (input.content.some((content) => content.demoOnly)) {
    blockers.push('DEMO_CONTENT_REFERENCED');
  } else if (input.content.some((content) => content.reviewStatus !== 'APPROVED')) {
    blockers.push('CONTENT_NOT_APPROVED');
  }

  return { allowed: blockers.length === 0, blockers };
}
