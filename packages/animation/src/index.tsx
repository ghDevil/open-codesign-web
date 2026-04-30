import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { CSSProperties, ReactElement } from 'react';
import {
  type AnimationCard,
  type AnimationScene,
  type AnimationSpec,
  aspectRatioToDimensions,
  normalizeAnimationSpec,
} from '@open-codesign/shared';

function motionSpring(style: AnimationSpec['motionStyle']) {
  switch (style) {
    case 'snappy':
      return { damping: 14, stiffness: 180, mass: 0.7 };
    case 'calm':
      return { damping: 20, stiffness: 85, mass: 1 };
    case 'playful':
      return { damping: 10, stiffness: 150, mass: 0.85 };
    case 'cinematic':
    default:
      return { damping: 18, stiffness: 120, mass: 0.9 };
  }
}

function px(value: number): string {
  return `${value}px`;
}

function sceneCardStyle(frame: number, durationInFrames: number, motionStyle: AnimationSpec['motionStyle']): CSSProperties {
  const enter = spring({
    frame,
    fps: 30,
    config: motionSpring(motionStyle),
  });
  const opacity = interpolate(
    frame,
    [0, 6, Math.max(durationInFrames - 10, 8), durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.ease },
  );
  const translateY = interpolate(enter, [0, 1], [36, 0]);
  const scale = interpolate(enter, [0, 1], [0.97, 1]);
  return {
    opacity,
    transform: `translateY(${translateY}px) scale(${scale})`,
  };
}

function SceneContainer(props: {
  scene: AnimationScene;
  spec: AnimationSpec;
  children: ReactElement | ReactElement[];
}) {
  const frame = useCurrentFrame();
  const sceneDuration = props.scene.durationInFrames ?? 60;
  const palette = props.spec.palette;
  const style = sceneCardStyle(frame, sceneDuration, props.spec.motionStyle);
  return (
    <AbsoluteFill
      style={{
        background:
          props.scene.background ??
          `radial-gradient(circle at 20% 20%, ${palette.accent}33 0%, transparent 36%), radial-gradient(circle at 85% 15%, ${palette.accent2}30 0%, transparent 28%), linear-gradient(145deg, ${palette.background} 0%, #040812 100%)`,
        color: palette.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.8), transparent)',
        }}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: px(32),
          height: '100%',
          padding: '100px 112px',
          ...style,
        }}
      >
        {props.children}
      </div>
    </AbsoluteFill>
  );
}

function renderCards(cards: AnimationCard[] | undefined, palette: AnimationSpec['palette']) {
  if (!cards || cards.length === 0) return null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(cards.length, 3)}, minmax(0, 1fr))`,
        gap: px(20),
      }}
    >
      {cards.map((card, index) => (
        <div
          key={`${card.title}:${index}`}
          style={{
            borderRadius: px(24),
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.08)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.22)',
            padding: px(24),
            display: 'flex',
            flexDirection: 'column',
            gap: px(12),
            minHeight: px(240),
          }}
        >
          {card.eyebrow ? (
            <div
              style={{
                fontSize: px(16),
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: palette.accent2,
              }}
            >
              {card.eyebrow}
            </div>
          ) : null}
          <div style={{ fontSize: px(34), lineHeight: 1.08, fontWeight: 600 }}>{card.title}</div>
          <div style={{ fontSize: px(20), lineHeight: 1.5, color: palette.muted }}>{card.body}</div>
        </div>
      ))}
    </div>
  );
}

function renderScene(scene: AnimationScene, spec: AnimationSpec): ReactElement {
  const palette = spec.palette;
  const titleAlign = scene.align === 'center' ? 'center' : 'left';
  const headerBlock = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: px(18),
        maxWidth: scene.layout === 'hero' ? '78%' : '62%',
        textAlign: titleAlign,
        alignSelf: scene.align === 'center' ? 'center' : 'stretch',
      }}
    >
      {scene.kicker ? (
        <div
          style={{
            fontSize: px(18),
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: scene.accent ?? palette.accent2,
          }}
        >
          {scene.kicker}
        </div>
      ) : null}
      <div style={{ fontSize: px(76), lineHeight: 0.96, fontWeight: 700 }}>{scene.title}</div>
      {scene.body ? (
        <div style={{ fontSize: px(24), lineHeight: 1.45, color: palette.muted }}>{scene.body}</div>
      ) : null}
      {scene.bullets && scene.bullets.length > 0 ? (
        <div style={{ display: 'grid', gap: px(14), marginTop: px(8) }}>
          {scene.bullets.map((bullet, index) => (
            <div
              key={`${bullet}:${index}`}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: px(12),
                fontSize: px(22),
                lineHeight: 1.45,
                color: palette.text,
              }}
            >
              <div
                style={{
                  marginTop: px(10),
                  width: px(8),
                  height: px(8),
                  borderRadius: px(999),
                  background: scene.accent ?? palette.accent,
                }}
              />
              <div>{bullet}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  switch (scene.layout) {
    case 'split':
      return (
        <SceneContainer scene={scene} spec={spec}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: px(28), alignItems: 'center' }}>
            {headerBlock}
            <div
              style={{
                borderRadius: px(28),
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                padding: px(28),
                boxShadow: '0 30px 90px rgba(0,0,0,0.22)',
                display: 'flex',
                flexDirection: 'column',
                gap: px(18),
              }}
            >
              {renderCards(scene.cards?.slice(0, 2), palette) ?? (
                <>
                  {scene.quote?.text ? (
                    <div style={{ fontSize: px(34), lineHeight: 1.18, fontWeight: 600 }}>
                      “{scene.quote.text}”
                    </div>
                  ) : null}
                  {scene.quote?.attribution ? (
                    <div style={{ fontSize: px(18), color: palette.muted }}>{scene.quote.attribution}</div>
                  ) : null}
                  {scene.imagePrompt ? (
                    <div
                      style={{
                        marginTop: px(12),
                        fontSize: px(16),
                        color: palette.muted,
                        borderTop: '1px solid rgba(255,255,255,0.12)',
                        paddingTop: px(14),
                      }}
                    >
                      Visual cue: {scene.imagePrompt}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </SceneContainer>
      );
    case 'cards':
      return (
        <SceneContainer scene={scene} spec={spec}>
          <>
            {headerBlock}
            {renderCards(scene.cards, palette) ?? <div />}
          </>
        </SceneContainer>
      );
    case 'quote':
      return (
        <SceneContainer scene={scene} spec={spec}>
          <div
            style={{
              display: 'grid',
              gap: px(28),
              alignContent: 'center',
              justifyItems: scene.align === 'center' ? 'center' : 'start',
            }}
          >
            {scene.kicker ? (
              <div
                style={{
                  fontSize: px(18),
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: scene.accent ?? palette.accent2,
                }}
              >
                {scene.kicker}
              </div>
            ) : null}
            <div
              style={{
                maxWidth: '76%',
                fontSize: px(72),
                lineHeight: 1,
                fontWeight: 700,
                textAlign: titleAlign,
              }}
            >
              “{scene.quote?.text ?? scene.title}”
            </div>
            <div style={{ fontSize: px(24), color: palette.muted }}>
              {scene.quote?.attribution ?? scene.body ?? ''}
            </div>
          </div>
        </SceneContainer>
      );
    case 'metrics':
      return (
        <SceneContainer scene={scene} spec={spec}>
          <>
            {headerBlock}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.min(scene.stats?.length ?? 3, 4)}, minmax(0, 1fr))`,
                gap: px(20),
              }}
            >
              {(scene.stats ?? []).map((stat, index) => (
                <div
                  key={`${stat.label}:${index}`}
                  style={{
                    borderRadius: px(24),
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: px(24),
                    display: 'grid',
                    gap: px(10),
                    minHeight: px(180),
                  }}
                >
                  <div style={{ fontSize: px(16), color: palette.muted, textTransform: 'uppercase' }}>
                    {stat.label}
                  </div>
                  <div style={{ fontSize: px(58), lineHeight: 1, fontWeight: 700 }}>{stat.value}</div>
                </div>
              ))}
            </div>
          </>
        </SceneContainer>
      );
    case 'cta':
      return (
        <SceneContainer scene={scene} spec={spec}>
          <div
            style={{
              display: 'grid',
              gap: px(24),
              justifyItems: scene.align === 'center' ? 'center' : 'start',
            }}
          >
            {headerBlock}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: px(220),
                padding: `${px(18)} ${px(28)}`,
                borderRadius: px(999),
                background: scene.accent ?? palette.accent,
                color: '#050814',
                fontSize: px(24),
                fontWeight: 700,
              }}
            >
              {scene.ctaLabel ?? 'Continue'}
            </div>
          </div>
        </SceneContainer>
      );
    case 'hero':
    default:
      return (
        <SceneContainer scene={scene} spec={spec}>
          <>
            {headerBlock}
            {renderCards(scene.cards?.slice(0, 3), palette)}
          </>
        </SceneContainer>
      );
  }
}

export function OpenCodesignAnimation(props: { spec: AnimationSpec }): ReactElement {
  const spec = normalizeAnimationSpec(props.spec);
  return (
    <AbsoluteFill style={{ backgroundColor: spec.palette.background }}>
      {spec.scenes.map((scene, index) => {
        const from = spec.scenes
          .slice(0, index)
          .reduce((sum, item) => sum + (item.durationInFrames ?? 0), 0);
        return (
          <Sequence
            key={scene.id}
            from={from}
            durationInFrames={scene.durationInFrames ?? 60}
          >
            {renderScene(scene, spec)}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

export function OpenCodesignAnimationPoster(props: { spec: AnimationSpec }): ReactElement {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const spec = normalizeAnimationSpec(props.spec);
  const activeScene = spec.scenes.find((scene, index) => {
    const start = spec.scenes
      .slice(0, index)
      .reduce((sum, item) => sum + (item.durationInFrames ?? 0), 0);
    const end = start + (scene.durationInFrames ?? 60);
    return frame >= start && frame < end;
  });
  if (!activeScene) return <OpenCodesignAnimation spec={spec} />;
  return (
    <AbsoluteFill style={{ background: spec.palette.background }}>
      <div
        style={{
          position: 'absolute',
          right: 24,
          top: 24,
          zIndex: 2,
          padding: '10px 14px',
          borderRadius: 999,
          background: 'rgba(0,0,0,0.45)',
          color: '#fff',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 16,
        }}
      >
        {spec.title} · {Math.round((spec.durationInFrames / fps) * 10) / 10}s
      </div>
      {renderScene(activeScene, spec)}
    </AbsoluteFill>
  );
}

export function animationDimensions(spec: AnimationSpec): { width: number; height: number } {
  return aspectRatioToDimensions(spec.aspectRatio);
}
