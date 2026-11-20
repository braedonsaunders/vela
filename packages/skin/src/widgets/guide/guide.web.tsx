import { lazy, Suspense, type ComponentProps } from 'react';
import { msg } from '@vela/core';
import type { WidgetProps } from '../../host';
import type { Guide as GuideContent } from './guide-content';
import { useGuideLook } from './look';
import { GuideStatus } from './status';

export type { GuideFocus } from './guide-content';

const DeferredGuide = lazy(() => import('./guide-content').then(module => ({ default: module.Guide })));

function LoadingGuide() {
  const look = useGuideLook();
  return <GuideStatus look={look} text={msg('ui.loadingTheGuide')} busy />;
}

export function Guide(props: ComponentProps<typeof GuideContent>) {
  return <Suspense fallback={<LoadingGuide />}><DeferredGuide {...props} /></Suspense>;
}

export function GuideWidget({ params }: WidgetProps) {
  return <Guide layout={params.layout === 'cinematic' ? 'cinematic' : undefined} />;
}
