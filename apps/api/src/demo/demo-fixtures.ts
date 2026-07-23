export type DemoFixture = {
  fixtureId: 'persona_fat_loss' | 'persona_muscle_gain';
  goalType: 'FAT_LOSS' | 'MUSCLE_GAIN';
  demoOnly: true;
  reviewStatus: 'DEMO_UNREVIEWED';
  publishable: false;
  disclaimer: '仅用于原型演示，未经专业审核';
};

const fixtureMetadata: Record<DemoFixture['fixtureId'], DemoFixture> = {
  persona_fat_loss: {
    fixtureId: 'persona_fat_loss',
    goalType: 'FAT_LOSS',
    demoOnly: true,
    reviewStatus: 'DEMO_UNREVIEWED',
    publishable: false,
    disclaimer: '仅用于原型演示，未经专业审核',
  },
  persona_muscle_gain: {
    fixtureId: 'persona_muscle_gain',
    goalType: 'MUSCLE_GAIN',
    demoOnly: true,
    reviewStatus: 'DEMO_UNREVIEWED',
    publishable: false,
    disclaimer: '仅用于原型演示，未经专业审核',
  },
};

export function getDemoFixture(fixtureId: string): DemoFixture | undefined {
  if (fixtureId !== 'persona_fat_loss' && fixtureId !== 'persona_muscle_gain') {
    return undefined;
  }
  return fixtureMetadata[fixtureId];
}
