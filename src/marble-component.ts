import { createComponent, Types } from '@iwsdk/core';

export const MarbleKinds = { Shooter: 'shooter', Target: 'target' } as const;

export const Marble = createComponent('Marble', {
  kind: {
    type: Types.Enum,
    default: MarbleKinds.Target,
    enum: MarbleKinds,
  },
});
