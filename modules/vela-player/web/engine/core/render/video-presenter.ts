import { playbackMark } from '../../timing';
import GPUVideoDecodeSession from 'webgpu-player/src/decode/video/gpu/GPUVideoDecodeSession';
import { getExternalHDRAuthorizationRouteKey } from 'webgpu-player/src/validation/ExternalHDRPresentationAuthorization';
import type { VideoPackages } from '../../universal/video/packages';
import Presenter from 'webgpu-player/src/presentation/WebGPUPresenter';
import {
  createSDRColorMetadata,
  createPQColorMetadata,
  createHLGColorMetadata,
  type ColorPrimaries,
  type YUVMatrix,
} from 'webgpu-player/src/color/ColorMetadata';
import {
  createDefaultRenderSettings,
  createHDRToSDRRenderSettings,
} from 'webgpu-player/src/presentation/RenderSettings';
import { createGPUVideoDecodeSessionFactory } from 'webgpu-player/src/presentation/PresentationSetup';
import { secondsToMicroseconds } from 'webgpu-player/src/MediaTime';
import { abortable } from '../async';
import type { CoreVideoFrame, VideoPresentation, VideoRoute } from '../decode/video';
import type { CorePresenter } from '../runtime';
import type { VideoTrack } from '../types';
import { conventionalColour } from './colour';
import { av1BitDepth } from '../decode/codec-config';

/** Upstream colour/frame presentation as a component; Vela owns its scheduling. */
export class CoreVideoPresenter implements CorePresenter, VideoPresentation {
  private presenter: Presenter;
  private warming = false;
  private warmFailure: Error | null = null;
  private epoch = 0;
  constructor(
    private surface: { container: HTMLDivElement; video: HTMLVideoElement },
    private onFailure: (error: Error) => void,
  ) {
    this.presenter = this.create();
  }
  private create() {
    return new Presenter(
      (_epoch, reason, detail) =>
        this.failed(new Error(`Video presentation: ${reason}${detail ? ` (${detail})` : ''}`)),
      () => {},
      () => this.failed(new Error('WebGPU device lost')),
    );
  }
  private failed(error: Error) {
    if (this.warming) this.warmFailure = error;
    else this.onFailure(error);
  }
  bind(surface: { container: HTMLDivElement; video: HTMLVideoElement }, onFailure: (error: Error) => void) {
    this.surface = surface;
    this.onFailure = onFailure;
  }
  reset() {
    this.presenter.destroy();
    this.presenter = this.create();
    this.epoch = 0;
    this.warmFailure = null;
  }
  park() {
    this.presenter.endSession(this.epoch + 1);
    this.epoch = 0;
    this.surface = { container: document.createElement('div'), video: document.createElement('video') };
  }
  async prewarm(
    packages: VideoPackages,
    signal: AbortSignal,
    shouldYield: () => boolean = () => false,
  ): Promise<boolean> {
    this.warming = true;
    this.presenter.startSession(0);
    try {
      const [device, decoder] = await abortable(
        Promise.all([this.presenter.getGPUVideoDecodeDevice(), packages.load('hevc', signal)]),
        signal,
      );
      if (!device || !decoder) throw new Error('Warm GPU decoder unavailable');
      for (const format of ['I420P10', 'I420'] as const) {
        signal.throwIfAborted();
        if (shouldYield()) return false;
        await abortable(
          GPUVideoDecodeSession.precompile({
            device,
            decoderPackage: decoder,
            manifest: decoder.manifest,
            format,
          }),
          signal,
        );
      }
      const facts = {
        primaries: 'bt2020' as const,
        matrix: 'bt2020-ncl' as const,
        bitDepth: 10,
        range: 'limited' as const,
      };
      const routes = [
        {
          format: 'I420' as const,
          metadata: createSDRColorMetadata({
            primaries: 'bt709',
            matrix: 'bt709',
            bitDepth: 8,
            range: 'limited',
          }),
        },
        {
          format: 'I420P10' as const,
          metadata: createSDRColorMetadata({
            primaries: 'bt709',
            matrix: 'bt709',
            bitDepth: 10,
            range: 'limited',
          }),
        },
        { format: 'I420P10' as const, metadata: createPQColorMetadata(facts) },
        { format: 'I420P10' as const, metadata: createHLGColorMetadata(facts) },
      ];
      for (const route of routes) {
        signal.throwIfAborted();
        if (shouldYield()) return false;
        const hdr = route.metadata.transfer !== 'sdr';
        const settings = hdr
          ? createHDRToSDRRenderSettings({ toneMapping: { inputPeakNits: route.metadata.nominalPeakNits } })
          : createDefaultRenderSettings();
        if (
          !(await abortable(
            this.presenter.configureColorPipeline({ inputMode: 'frame-pool', ...route, settings }, 0),
            signal,
          ))
        )
          throw new Error('Warm colour route unavailable');
      }
      if (shouldYield()) return false;
      await abortable(this.presenter.prewarmExternalHDRPresentationAuthorization(), signal);
      if (this.warmFailure) throw this.warmFailure;
      return true;
    } finally {
      this.warming = false;
      this.park();
    }
  }
  createGPUDecodeFactory() {
    return createGPUVideoDecodeSessionFactory(this.presenter, { slicing: true });
  }
  async prepare(
    track: VideoTrack,
    epoch: number,
    signal: AbortSignal,
    route: VideoRoute = { kind: 'native' },
  ): Promise<void> {
    const transfer = String(track.color.transfer ?? '');
    const hdr =
      transfer === 'pq' || transfer === 'hlg' || transfer === 'smpte2084' || transfer === 'arib-std-b67';
    // A package's parser hands the presenter each picture's fields, which it deinterlaces; a
    // browser decoder's frames carry no field facts.
    const interlaced = !!track.fieldOrder && track.fieldOrder !== 'progressive';
    if (track.rotation !== 0 || (interlaced && route.kind !== 'gpu'))
      throw new Error('This actual scan/rotation needs an additional presentation route');
    // Undeclared SDR colour on the package route takes the convention every player applies:
    // BT.709 for HD, BT.601 (625 or 525 lines) for SD.
    const assumed = route.kind === 'gpu' && !hdr ? conventionalColour(track) : null;
    const primaries = track.color.primaries ?? assumed?.primaries,
      matrix = track.color.matrix ?? assumed?.matrix;
    // Native VideoFrames carry their decoder/browser colour conversion. Missing
    // container facts must not become invented source metadata; raw planes and
    // HDR still require the qualified colour route below.
    const browserIdentity = route.kind === 'native' && !hdr && (!primaries || !matrix);
    if (
      !browserIdentity &&
      (!primaries ||
        !matrix ||
        !['bt709', 'bt2020', 'bt470bg', 'smpte170m'].includes(primaries) ||
        !['bt709', 'bt2020-ncl', 'bt470bg', 'smpte170m'].includes(matrix))
    )
      throw new Error('Actual video colour needs a qualified presentation route');
    // seek() retains the previous colour pipeline. A new session is the pinned
    // component's public reset to external identity with metadata:null, including
    // when this presenter previously carried a known HDR or frame-pool route.
    if (browserIdentity || this.epoch === 0) this.presenter.startSession(epoch);
    else this.presenter.seek(epoch);
    this.epoch = epoch;
    this.presenter.setDecodedFramePushMode(true, epoch);
    this.presenter.attach(this.surface, epoch);
    if (browserIdentity) {
      await abortable(
        this.presenter.prepareDecodedVideo(
          { chromaFormat: null, frameWidth: track.width, frameHeight: track.height },
          epoch,
        ),
        signal,
      );
      signal.throwIfAborted();
      if (this.epoch !== epoch) throw new DOMException('Presentation superseded', 'AbortError');
      return;
    }
    const bytes = track.config?.description;
    const privateBytes = bytes
      ? ArrayBuffer.isView(bytes)
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8Array(bytes)
      : null;
    const bitDepth =
      track.codec === 'hevc' && privateBytes && privateBytes.length >= 23 && privateBytes[0] === 1
        ? 8 + (privateBytes[17] & 7)
        : track.codec === 'av1'
          ? (av1BitDepth(privateBytes) ?? 8)
          : 8;
    const facts = {
      primaries: primaries as ColorPrimaries,
      matrix: matrix as YUVMatrix,
      bitDepth,
      range: track.color.fullRange ? ('full' as const) : ('limited' as const),
    };
    const metadata =
      transfer === 'pq' || transfer === 'smpte2084'
        ? createPQColorMetadata(facts)
        : transfer === 'hlg' || transfer === 'arib-std-b67'
          ? createHLGColorMetadata(facts)
          : createSDRColorMetadata(facts);
    const settings = hdr
      ? createHDRToSDRRenderSettings({ toneMapping: { inputPeakNits: metadata.nominalPeakNits } })
      : createDefaultRenderSettings();
    // The validated external HDR routes exist for neutralized HEVC and AV1 hardware frames only.
    const externalCodec = track.codec === 'hevc' || track.codec === 'av1' ? track.codec : null;
    if (route.kind === 'native' && hdr) {
      if (!externalCodec) throw new Error('Native HDR codec needs package presentation');
      const key = getExternalHDRAuthorizationRouteKey(externalCodec, metadata);
      if (!key) throw new Error('Native HDR colour route needs package presentation');
      await abortable(this.presenter.waitForExternalHDRRouteAuthorization(externalCodec, metadata), signal);
      if (!this.presenter.getAuthorizedExternalHDRRouteKeys().includes(key))
        throw new Error('Native HDR route is not validated on this device');
    }
    const configured = await abortable(
      this.presenter.configureColorPipeline(
        route.kind === 'gpu'
          ? {
              inputMode: 'frame-pool',
              format: route.format,
              metadata,
              settings,
              automaticInputPeakNits: true,
            }
          : hdr
            ? {
                inputMode: 'external-hdr',
                codec: externalCodec!,
                metadata,
                settings: createHDRToSDRRenderSettings({
                  toneMapping: { inputPeakNits: metadata.nominalPeakNits },
                }),
              }
            : { metadata, settings: createDefaultRenderSettings() },
        epoch,
      ),
      signal,
    );
    signal.throwIfAborted();
    if (this.epoch !== epoch) throw new DOMException('Presentation superseded', 'AbortError');
    if (!configured) throw new Error('WebGPU colour pipeline could not be prepared');
    await abortable(
      this.presenter.prepareDecodedVideo(
        { chromaFormat: null, frameWidth: track.width, frameHeight: track.height },
        epoch,
      ),
      signal,
    );
  }
  present(frame: CoreVideoFrame, positionUs: number): boolean {
    const drawn =
      frame.kind === 'gpu'
        ? this.presenter.presentDecodedFrame(
            frame.frame,
            frame.epoch,
            undefined,
            secondsToMicroseconds(positionUs / 1e6),
          )
        : this.presenter.presentDecodedFrame(
            {
              outputMode: 'video-frame',
              frame: frame.frame,
              mediaTimeMicroseconds: secondsToMicroseconds(frame.timestampUs / 1e6),
              durationMicroseconds: secondsToMicroseconds(frame.durationUs / 1e6),
            },
            frame.epoch,
            undefined,
            secondsToMicroseconds(positionUs / 1e6),
          );
    if (drawn) playbackMark('first-frame', 'webgpu');
    return drawn;
  }
  dispose() {
    this.presenter.destroy();
  }
}
