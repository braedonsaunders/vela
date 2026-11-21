// The chrome's two bars over gradients that fade into the picture: the top bar (close, and
// what is playing) and the bottom bar (a refused command, the chapter strip, the timeline,
// the clock, then icon transport and the screening controls with their menus). Both slide
// and fade with the chrome's visibility.
import { LinearGradient } from 'expo-linear-gradient';
import { useRef, type ComponentRef, type ReactNode } from 'react';
import { Platform, Text, View, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { msg } from '@vela/core';
import { easing } from '../../motion';
import { ChromeButton } from './button';
import { ChapterStrip } from './chapters';
import { LiveDial, LiveMark, LiveStatusLine, LiveZap, type LiveWatch } from './live';
import type { CommandInput, PlayerChromeState } from './context';
import type { PlayerLook } from './look';
import { MenuPanel } from './menu';
import { AudioMenu, qualityMenuRows, SpeedMenu, SubtitlesMenu, type MenuName } from './menus';
import type { PlayerView } from './present';
import { Scrubber } from './scrubber';
import { Volume } from './volume';

export type Opened = MenuName | 'chapters' | null;

/** `#rrggbb[aa]` with no alpha, so a gradient fades in the colour itself rather than through black. */
function clear(colour: string): string {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(colour);
  return hex ? `#${hex[1]}00` : 'transparent';
}

// UIKit must be able to focus the controls in the same commit that removes the hidden
// picture target. An animated bar can still be moving when requestTVFocus is processed.
function shownStyle(look: PlayerLook, visible: boolean, from: number): ViewStyle {
  return {
    opacity: visible ? 1 : 0,
    transform: [{ translateY: visible || look.still || look.tv ? 0 : from }],
    transitionProperty: ['opacity', 'transform'],
    transitionDuration: look.tv ? 0 : look.still ? 160 : 420,
    // Native Reanimated takes a bezier only as cubicBezier(): easing() converts the CSS text.
    transitionTimingFunction: easing('cubic-bezier(0.16, 1, 0.3, 1)'),
  } as ViewStyle;
}

/** Hidden TV controls leave the native focus tree completely. A disabled focus guide around
 * a live row can retain a destination and send horizontal navigation back to that child. */
function FocusZone({ visible, children }: { visible: boolean; children: ReactNode }) {
  return Platform.isTV && !visible ? null : <>{children}</>;
}

interface TopProps {
  look: PlayerLook;
  title: string;
  visible: boolean;
  onClose(): void;
}

export function TopBar({ look, title, visible, onClose }: TopProps) {
  const fade = look.small ? 72 : look.size(140);
  return (
    <Animated.View pointerEvents={visible ? 'box-none' : 'none'} style={shownStyle(look, visible, -14)}>
      <LinearGradient
        colors={[look.scrim, look.scrim, clear(look.scrim)]}
        locations={[0, 0.55, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        pointerEvents="none"
      />
      <FocusZone visible={visible}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: look.size(look.small ? 14 : 20),
            paddingTop: look.small ? 18 : look.size(30),
            paddingHorizontal: look.gutter,
            paddingBottom: fade,
          }}
        >
          <ChromeButton
            look={look}
            icon="back"
            label={msg('ui.closePlayer')}
            size={46}
            onPress={onClose}
            testID="player-close"
          />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text
              style={[look.text(10, 650, look.inkQuiet), { letterSpacing: look.size(1.4), textTransform: 'uppercase' }]}
            >
              {msg('ui.nowPlaying')}
            </Text>
            <Text
              numberOfLines={1}
              style={[
                look.display(look.small ? 24 : 34),
                { textShadowColor: look.shadow, textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 18 },
              ]}
            >
              {title}
            </Text>
          </View>
        </View>
      </FocusZone>
    </Animated.View>
  );
}

interface BottomProps {
  look: PlayerLook;
  state: PlayerChromeState;
  view: PlayerView;
  visible: boolean;
  blocked: boolean;
  opened: Opened;
  info: boolean;
  menuHeight: number;
  send(command: CommandInput): void;
  seek(seconds: number): void;
  seekBy(seconds: number): void;
  toggle(menu: Exclude<Opened, null>): void;
  closeMenu(): void;
  toggleInfo(): void;
  onActive(active: boolean): void;
  live: LiveWatch;
}

export function BottomBar(props: BottomProps) {
  const { look, state, view, visible, blocked, opened } = props;
  const fade = look.small ? 80 : look.size(150);
  return (
    <Animated.View pointerEvents={visible ? 'box-none' : 'none'} style={shownStyle(look, visible, 18)}>
      <LinearGradient
        colors={[clear(look.scrim), look.scrim, look.scrim]}
        locations={[0, 0.45, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        pointerEvents="none"
      />
      <FocusZone visible={visible}>
        <View
          style={{
            paddingTop: fade,
            paddingHorizontal: look.gutter,
            paddingBottom: look.small ? 18 : look.size(30),
            gap: look.size(look.small ? 10 : 14),
          }}
        >
          {state.actionError && !state.failure ? (
            <Text accessibilityRole="alert" style={look.text(13, 500, look.accent)}>
              {state.actionError}
            </Text>
          ) : null}
          {Platform.OS === 'web' && opened === 'chapters' && view.chapters.length ? (
            <ChapterStrip look={look} view={view} disabled={blocked} onSeek={props.seek} />
          ) : null}
          {props.live.live ? (
            <View style={{ alignItems: look.small ? 'stretch' : 'flex-start', gap: look.size(10) }}>
              <LiveDial channelId={props.live.channelId} small={look.small} still={look.still} />
              <LiveStatusLine look={look} watch={props.live} />
            </View>
          ) : (
            <Timeline {...props} />
          )}
          <Controls {...props} />
        </View>
      </FocusZone>
    </Animated.View>
  );
}

/** The timeline and the clock under it. */
function Timeline({ look, state, view, blocked, seek, onActive }: BottomProps) {
  return (
    <View>
      <Scrubber
        look={look}
        view={view}
        disabled={blocked}
        onSeek={seek}
        onActive={onActive}
        thumbnail={state.thumbnail}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[look.text(12, 400, look.inkSecondary), { fontVariant: ['tabular-nums'] }]}>{view.elapsed}</Text>
        <Text style={[look.text(12, 400, look.inkSecondary), { fontVariant: ['tabular-nums'] }]}>{view.remaining}</Text>
      </View>
    </View>
  );
}

function Controls({
  state,
  look,
  view,
  blocked,
  opened,
  info,
  menuHeight,
  send,
  seekBy,
  seek,
  toggle,
  closeMenu,
  toggleInfo,
  onActive,
  live,
  visible,
}: BottomProps) {
  // A channel plays at the live edge: channel up and down and the LIVE mark take the place of
  // the ten-second steps; no speed, no chapters.
  const timeline = !live.live;
  const gap = look.size(look.small ? 4 : 8);
  const anchorRef = useRef<ComponentRef<typeof View>>(null);
  const names: Record<Exclude<Opened, null>, string> = {
    subtitles: msg('ui.subtitles'),
    audio: msg('ui.audio'),
    quality: msg('ui.quality'),
    speed: msg('player.speed'),
    chapters: msg('ui.chapters'),
  };
  const menu = opened === 'chapters' && Platform.OS === 'web' ? null : opened;
  const contents = (name: Exclude<Opened, null>): ReactNode => {
    switch (name) {
      case 'chapters':
        return <ChapterStrip look={look} view={view} disabled={blocked} onSeek={seek} />;
      case 'subtitles':
        return <SubtitlesMenu look={look} view={view} blocked={blocked} send={send} />;
      case 'audio':
        return <AudioMenu look={look} view={view} blocked={blocked} send={send} />;
      case 'quality':
        return qualityMenuRows({
          look, view, plan: state.plan, blocked, send, switchVersion: state.switchVersion,
          pendingVersionId: state.pendingVersionId, versionMessage: state.versionMessage,
          pendingQualityId: state.pendingQualityId, info, onInfo: toggleInfo,
        });
      case 'speed':
        return <SpeedMenu look={look} view={view} blocked={blocked} send={send} />;
    }
  };
  // Phones put the screening controls on a line of their own when the transport leaves no room.
  const cluster: ViewStyle = look.small
    ? { flexGrow: 1, flexDirection: 'row', justifyContent: 'flex-end', gap }
    : { flex: 1, minWidth: 0, flexDirection: 'row', justifyContent: 'flex-end', gap };
  // Each TV button is a native focus destination. The play toggle claims focus once on
  // reveal/readiness; menus and position reports never reclaim it.
  const Row = View;
  return (
    <Row ref={anchorRef} collapsable={false}
      style={{ flexDirection: 'row', flexWrap: look.small ? 'wrap' : 'nowrap', alignItems: 'center', gap }}
    >
      <ChromeButton
        key={Platform.isTV && visible && !blocked ? 'focus-ready' : 'inactive'}
        look={look}
        primary
        preferred={Platform.isTV && visible && !blocked}
        icon={view.playing ? 'pause' : 'play'}
        label={view.ended ? msg('ui.finished') : view.playing ? msg('ui.pause') : msg('ui.play')}
        disabled={blocked}
        size={look.small ? 48 : 52}
        testID="player-toggle"
        onPress={() => send({ type: view.playing ? 'pause' : 'play' })}
      />
      {timeline ? (
        <>
          <ChromeButton
            look={look}
            icon="skipBack"
            label={msg('ui.back10Seconds')}
            disabled={blocked}
            onPress={() => seekBy(-10)}
          />
          <ChromeButton
            look={look}
            icon="skipForward"
            label={msg('ui.forward10Seconds')}
            disabled={blocked || view.duration <= 0}
            onPress={() => seekBy(10)}
          />
        </>
      ) : null}
      {timeline ? <ChromeButton look={look} icon="restart" label={msg('ui.startOver')}
        disabled={blocked} testID="player-start-over" onPress={() => seek(0)} /> : null}
      {timeline ? null : <LiveZap look={look} watch={live} disabled={!live.canZap} />}
      <Volume look={look} view={view} send={send} onActive={onActive} />
      {timeline ? null : <LiveMark look={look} watch={live} send={send} />}
      <View style={cluster}>
        {look.small ? null : (
          <Text
            numberOfLines={1}
            testID="player-quality"
            style={[
              look.text(11, 600, look.inkSecondary),
              {
                alignSelf: 'center',
                flexShrink: 1,
                letterSpacing: look.size(0.4),
                paddingHorizontal: look.size(10),
                paddingVertical: look.size(4),
                borderWidth: 1,
                borderColor: look.glassEdge,
                borderRadius: look.size(6),
                marginRight: look.size(6),
              },
            ]}
          >
            {view.quality || view.path}
          </Text>
        )}
        <ChromeButton
          look={look}
          icon={view.subtitleId ? 'captionsOn' : 'captions'}
          compact
          label={names.subtitles}
          selected={opened === 'subtitles'}
          testID="player-cc-button"
          onPress={() => toggle('subtitles')}
        />
        <ChromeButton
          look={look}
          icon="audio"
          compact
          label={names.audio}
          selected={opened === 'audio'}
          testID="player-audio-button"
          onPress={() => toggle('audio')}
        />
        <ChromeButton
          look={look}
          icon="quality"
          compact
          label={names.quality}
          selected={opened === 'quality'}
          testID="player-quality-button"
          onPress={() => toggle('quality')}
        />
        {timeline ? (
          <>
            <ChromeButton
              look={look}
              icon="speed"
              compact
              label={names.speed}
              selected={opened === 'speed'}
              testID="player-speed-button"
              onPress={() => toggle('speed')}
            />
            <ChromeButton
              look={look}
              icon="chapters"
              compact
              label={msg('ui.chapters')}
              selected={opened === 'chapters'}
              disabled={!view.chapters.length}
              testID="player-chapters-button"
              onPress={() => toggle('chapters')}
            />
          </>
        ) : null}
        {view.pip ? (
          <ChromeButton
            look={look}
            icon="pip"
            compact
            label={msg('ui.pictureInPicture')}
            onPress={() => send({ type: 'pip' })}
          />
        ) : null}
        {view.fullscreen ? (
          <ChromeButton
            look={look}
            icon="fullscreen"
            compact
            label={msg('ui.fullscreen')}
            onPress={() => send({ type: 'fullscreen' })}
          />
        ) : null}
      </View>
      {menu ? (
        <MenuPanel look={look} name={names[menu]} maxHeight={menuHeight} wide={menu === 'quality' && !!state.plan?.versions?.length} anchorRef={anchorRef} onClose={closeMenu}>
          {contents(menu)}
        </MenuPanel>
      ) : null}
    </Row>
  );
}
