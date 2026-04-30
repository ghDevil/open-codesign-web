import { OpenCodesignAnimation } from '@open-codesign/animation';
import {
  aspectRatioToDimensions,
  extractAnimationSpecFromHtml,
} from '@open-codesign/shared';
import { Player } from '@remotion/player';
import type { ReactElement } from 'react';
import { useMemo } from 'react';

export function AnimationPreviewPanel(props: { html: string }): ReactElement {
  const spec = useMemo(() => extractAnimationSpecFromHtml(props.html), [props.html]);

  if (!spec) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-background)] p-8">
        <div className="max-w-[560px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <div className="text-[16px] font-medium text-[var(--color-text-primary)]">
            Animation preview unavailable
          </div>
          <p className="mt-2 mb-0 text-[13px] leading-[1.6] text-[var(--color-text-muted)]">
            This design is in animation mode, but the generated artifact does not include a valid
            Remotion JSON spec yet. Ask the model to regenerate the animation storyboard.
          </p>
        </div>
      </div>
    );
  }

  const dimensions = aspectRatioToDimensions(spec.aspectRatio);
  const seconds = Math.round((spec.durationInFrames / spec.fps) * 10) / 10;

  return (
    <div className="flex h-full flex-col overflow-auto bg-[var(--color-background)] px-6 py-5">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-[18px] font-medium text-[var(--color-text-primary)]">{spec.title}</div>
            <div className="text-[12px] text-[var(--color-text-muted)]">
              {spec.aspectRatio} · {spec.fps} fps · {seconds}s · {spec.motionStyle}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {spec.scenes.map((scene) => (
              <div
                key={scene.id}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-[11px] text-[var(--color-text-secondary)]"
              >
                {scene.layout}
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[#040812] shadow-[var(--shadow-elevated)]">
          <Player
            component={OpenCodesignAnimation}
            inputProps={{ spec }}
            durationInFrames={spec.durationInFrames}
            compositionWidth={dimensions.width}
            compositionHeight={dimensions.height}
            fps={spec.fps}
            controls
            showVolumeControls={false}
            clickToPlay
            doubleClickToFullscreen
            moveToBeginningWhenEnded
            style={{ width: '100%', aspectRatio: `${dimensions.width} / ${dimensions.height}` }}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {spec.scenes.map((scene) => (
            <div
              key={scene.id}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                {scene.layout}
              </div>
              <div className="mt-2 text-[15px] font-medium text-[var(--color-text-primary)]">
                {scene.title}
              </div>
              {scene.body ? (
                <p className="mt-2 mb-0 text-[12px] leading-[1.55] text-[var(--color-text-muted)]">
                  {scene.body}
                </p>
              ) : null}
              <div className="mt-3 text-[11px] text-[var(--color-text-muted)]">
                {(scene.durationInFrames ?? 0) / spec.fps}s
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
