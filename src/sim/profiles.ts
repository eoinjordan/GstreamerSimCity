import type { Backend, Settings, Source } from './model'

export type Kind = 'source' | 'transform' | 'split' | 'queue' | 'inference' | 'metadata' | 'join' | 'overlay' | 'sink'
export type Payload = 'video' | 'tensor' | 'metadata' | 'annotated'

export const COLORS: Record<Kind | Payload, string> = {
  source: '#f48c82', transform: '#69c9e8', split: '#d1d7d8', queue: '#edc86e',
  inference: '#a9df72', metadata: '#ea8ec5', join: '#81c9bc', overlay: '#baade9',
  sink: '#9ccee0', video: '#63d6ed', tensor: '#efc76b', annotated: '#b1e57f',
}

export const REFERENCES = {
  workshop: 'https://github.com/eoinjordan/multisolutions_workshop',
  deployment: 'https://docs.edgeimpulse.com/hardware/deployments/run-qualcomm-im-sdk-gstreamer',
  imsdk: 'https://imsdkdocs.qualcomm.com/sample-pipelines/aipipelines',
  nvidia: 'https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_C_Sample_Apps.html',
  queue: 'https://gstreamer.freedesktop.org/documentation/coreelements/queue.html',
  tee: 'https://gstreamer.freedesktop.org/documentation/coreelements/tee.html',
} as const

export interface Element {
  id: string
  title: string
  plugin: string
  kind: Kind
  position: [number, number]
  description: string
  input: string
  output: string
  execution: string
  caution: string
  reference: string
}

export interface Link { id: string; from: string; to: string; payload: Payload; label: string }
export interface Profile {
  id: Backend
  name: string
  vendor: string
  target: string
  runtime: string
  memory: string
  nodes: Element[]
  links: Link[]
  tour: string[]
  prerequisites: string[]
}

function link(from: string, to: string, payload: Payload, label: string): Link {
  return { id: `${from}-${to}`, from, to, payload, label }
}

function element(id: string, title: string, plugin: string, kind: Kind, position: [number, number], description: string, input: string, output: string, execution: string, caution: string, reference: string): Element {
  return { id, title, plugin, kind, position, description, input, output, execution, caution, reference }
}

const queueDescription = 'A queue creates a streaming-thread boundary. It decouples upstream and downstream until its capacity is reached. Non-leaky mode then blocks the producer; leaky mode drops either the oldest or newest queued buffer.'
const queueCaution = 'The adjustable queue represents the inference bottleneck only. Other scheduling queues are collapsed in this teaching graph. Real queues also have byte and time limits.'

export function getProfile(backend: Backend, source: Source): Profile {
  const file = source === 'file'
  const queue = element('queue', 'Inference queue', 'queue', 'queue', [-4, -4], queueDescription, 'video/x-raw', 'video/x-raw', 'GStreamer streaming thread', queueCaution, REFERENCES.queue)
  if (backend === 'imsdk') {
    const nodes = [
      element('source', file ? 'Video file' : 'USB camera', file ? 'filesrc + qtdemux + h264parse' : 'v4l2src', 'source', [-12, 1], file ? 'The source bin reads an MP4 container, extracts its H.264 video stream, and parses access units for the decoder.' : 'V4L2 captures frames from a USB camera. Frame format, size, and cadence must be supported by the device.', file ? 'MP4 / H.264 asset' : '/dev/video0', file ? 'video/x-h264' : 'video/x-raw, format=YUY2', file ? 'CPU / file I/O' : 'V4L2 camera driver', 'The browser generates synthetic frames. No camera or file is being opened. The workshop bundle can use a board-specific CSI source instead.', REFERENCES.imsdk),
      element('convert', file ? 'Hardware decode' : 'Video transform', file ? 'v4l2h264dec' : 'qtivtransform', 'transform', [-8, 1], file ? 'The V4L2 decoder produces raw NV12 surfaces from H.264 access units.' : 'The transform element converts the captured video into the NV12 format consumed by the rest of this pipeline.', file ? 'video/x-h264' : 'video/x-raw, format=YUY2', 'video/x-raw, format=NV12', file ? 'Video decoder' : 'Qualcomm multimedia / GPU path', 'A hardware-capable element does not prove a zero-copy path. Allocators, caps features, strides, and mapping all matter.', REFERENCES.imsdk),
      element('tee', 'Stream split', 'tee', 'split', [-4, 1], 'The tee shares video buffers with a video branch and an inference branch. Separate queues isolate their streaming threads; a full non-leaky branch can still backpressure the whole pipeline.', 'video/x-raw, NV12', 'src_%u: video/x-raw, NV12', 'GStreamer / request pads', 'Duplicating a buffer reference is not necessarily copying its pixels. The branches do not become independent clocks.', REFERENCES.tee),
      queue,
      element('preprocess', 'Tensor preparation', 'qtimlvconverter', 'transform', [0, -4], 'Resize, color conversion, and normalization turn video into tensors matching the model input. Tensor dimensions and layout come from the selected model, not the capture resolution.', 'video/x-raw, NV12', 'Model-shaped input tensors', 'Qualcomm ML preprocessing', 'The exact tensor caps, quantization, and image disposition must match the exported model. They are not inferred from a filename.', 'https://imsdkdocs.qualcomm.com/plugin-reference/qtimlvconverter'),
      element('inference', 'Model execution', 'qtimltflite', 'inference', [4, -4], 'LiteRT executes the model. The documented QNN external delegate can request the HTP backend on a compatible Qualcomm target. Unsupported operations, runtime setup, and model format affect actual offload.', 'Model input tensors', 'Detection result tensors', 'LiteRT + QNN delegate / HTP requested', 'NPU presence is not evidence of NPU execution. Validate the QNN runtime and profile layer placement. This scene makes no offload claim.', 'https://imsdkdocs.qualcomm.com/plugin-reference/qtimltflite'),
      element('postprocess', 'Detection metadata', 'qtimlpostprocess', 'metadata', [8, -4], 'A model-specific decoder interprets detection tensors and emits bounding boxes and labels as a text/metadata stream. Its parser must match the model output layout.', 'Detection result tensors', 'text/x-raw / detection records', 'Model-specific postprocessing', 'The Edge Impulse workshop deployment supports YOLO-based models only. Current SDK parser names and label formats can differ from the older exported bundle.', 'https://imsdkdocs.qualcomm.com/plugin-reference/qtimlpostprocess'),
      element('videoqueue', 'Video branch', 'queue', 'queue', [-1, 3.5], 'The video branch retains the raw frame path while the other branch produces inference results. Its queue is distinct from the inference queue.', 'video/x-raw, NV12', 'video/x-raw, NV12', 'GStreamer streaming thread', 'This branch is structural context. Its queue capacity and metadata synchronization are not independently simulated.', REFERENCES.queue),
      element('join', 'Metadata merge', 'qtimetamux', 'join', [5, 3.5], 'The metadata mux joins raw video with the detection records and attaches inference results to video buffers. Pixels and detection metadata remain different kinds of data.', 'NV12 video + text/x-raw metadata', 'Video with attached metadata', 'GStreamer / Qualcomm metadata', 'Matching, timeout, and stale-result policies depend on the SDK. The model follows completed inference frames rather than emulating the metadata mux.', 'https://imsdkdocs.qualcomm.com/plugin-reference/qtimetamux'),
      element('overlay', 'Bounding-box overlay', 'qtivoverlay', 'overlay', [9, 3.5], 'The overlay reads attached metadata and draws labels and bounding boxes onto the video. It is a multimedia stage, not another neural-network inference.', 'Video with detection metadata', 'Annotated raw video', 'Qualcomm overlay / OpenCL path', 'qtivcomposer is a separate multi-video composition element. It is not interchangeable with a metadata mux or bounding-box overlay.', 'https://imsdkdocs.qualcomm.com/plugin-reference/qtivoverlay'),
      element('output', file ? 'Encoded output' : 'Wayland display', file ? 'v4l2h264enc + mp4mux + filesink' : 'waylandsink', 'sink', [13, 3.5], file ? 'An encoder, H.264 parser, and MP4 muxer write an annotated file. EOS lets the muxer finalize the container.' : 'The sink schedules presentation against the pipeline clock and displays annotated frames through Wayland/Weston.', 'Annotated video', file ? 'Annotated MP4 file' : 'Display surface', file ? 'Video encoder + filesystem' : 'Wayland compositor', 'The workshop sets XDG_RUNTIME_DIR and WAYLAND_DISPLAY for its image. Use values that match the actual board session.', REFERENCES.deployment),
    ]
    return {
      id: backend, name: 'IM SDK', vendor: 'Qualcomm', target: 'Dragonwing / QCS6490 context', runtime: 'LiteRT + QNN / HTP', memory: 'NV12 / platform buffers', nodes,
      links: [link('source', 'convert', 'video', file ? 'H.264 access units' : 'YUY2 frames'), link('convert', 'tee', 'video', 'NV12 video'), link('tee', 'queue', 'video', 'Inference branch'), link('queue', 'preprocess', 'video', 'Queued frames'), link('preprocess', 'inference', 'tensor', 'Input tensors'), link('inference', 'postprocess', 'tensor', 'Output tensors'), link('postprocess', 'join', 'metadata', 'Detection records'), link('tee', 'videoqueue', 'video', 'Video branch'), link('videoqueue', 'join', 'video', 'Original video'), link('join', 'overlay', 'annotated', 'Video + metadata'), link('overlay', 'output', 'annotated', 'Annotated video')],
      tour: ['source', 'tee', 'queue', 'preprocess', 'inference', 'postprocess', 'join', 'output'],
      prerequisites: ['Matching Qualcomm Linux / QIM SDK image and camera drivers.', 'An Edge Impulse IM SDK deployment ZIP with a supported YOLO model, labels, and its generated scripts.', 'QNN libraries, compatible delegate, and verified HTP access. Profile placement before claiming NPU offload.', 'A working Wayland session for display, or a writable output location for file mode.', 'Current QIM plugin names shown here are not a promise that an older IM SDK 2.x bundle uses identical factories.'],
    }
  }
  queue.position = [-4, -2]
  const nodes = [
    element('source', file ? 'Video file' : 'CSI camera', file ? 'filesrc + qtdemux + h264parse' : 'nvarguscamerasrc', 'source', [-12, -2], file ? 'The source bin demuxes an MP4 asset and parses its H.264 video for the NVIDIA decoder.' : 'On Jetson, the Argus camera source captures from a supported CSI sensor and produces NVIDIA-managed video surfaces.', file ? 'MP4 / H.264 asset' : 'Jetson CSI sensor', file ? 'video/x-h264' : 'video/x-raw(memory:NVMM), NV12', file ? 'CPU / file I/O' : 'Jetson camera / ISP', 'nvarguscamerasrc is Jetson-specific. On a discrete GPU use a supported file, RTSP, or USB source and the appropriate conversion path.', REFERENCES.nvidia),
    element('convert', file ? 'Hardware decode' : 'Video transform', file ? 'nvv4l2decoder' : 'nvvideoconvert', 'transform', [-8, -2], file ? 'The NVIDIA decoder turns compressed H.264 into raw video surfaces for DeepStream.' : 'The converter transforms video while preserving a compatible NVIDIA buffer path into the stream muxer.', file ? 'video/x-h264' : 'NVMM video', 'video/x-raw(memory:NVMM), NV12', file ? 'NVIDIA video decoder' : 'NVIDIA conversion path', 'NVMM is a caps/memory contract, not a benchmark or proof of zero copies across the entire pipeline.', REFERENCES.nvidia),
    queue,
    element('batch', 'Stream batching', 'nvstreammux', 'join', [0, -2], 'The muxer collects source frames into a batch and attaches batch/frame metadata. Each input connects to a requested sink pad. This single-source profile uses batch-size=1.', 'sink_%u: NVMM video', 'Batched NVMM video + NvDsBatchMeta', 'DeepStream stream mux', 'Batching is not an inference speed multiplier. Multi-source timeout and synchronization behavior vary between legacy and new mux implementations.', 'https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_plugin_gst-nvstreammux.html'),
    element('inference', 'Model execution', 'nvinfer', 'inference', [4, -2], 'The primary GIE preprocesses the batch, invokes TensorRT, parses outputs, and attaches object metadata to the original buffers. It does not replace the video stream with tensors.', 'NVMM video + batch metadata', 'NVMM video + NvDsObjectMeta', 'TensorRT / NVIDIA GPU', 'A TFLite file from an IM SDK deployment is not a drop-in TensorRT engine. Export a supported model and configure preprocessing, labels, and a matching parser.', 'https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_plugin_gst-nvinfer.html'),
    element('postprocess', 'Overlay format', 'nvvideoconvert', 'transform', [8, -2], 'The converter prepares video for the OSD stage. RGBA is a common OSD input format; support also depends on OSD processing mode and SDK version.', 'NVMM video with metadata', 'video/x-raw(memory:NVMM), RGBA + metadata', 'NVIDIA conversion path', 'Detection parsing is inside nvinfer or a custom parser. This stage converts pixels; it does not perform another detection.', 'https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_plugin_gst-nvvideoconvert.html'),
    element('overlay', 'Bounding-box overlay', 'nvdsosd', 'overlay', [8, 3.5], 'The on-screen display consumes NvDsObjectMeta to draw boxes, labels, and other annotations. Metadata accompanies the frame through the graph instead of arriving through a separate tee branch.', 'RGBA video + object metadata', 'Annotated video', 'DeepStream OSD', 'The demonstration boxes are synthetic graphics, not predictions made by an installed model.', 'https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_plugin_gst-nvdsosd.html'),
    element('output', file ? 'Encoded output' : 'Jetson display', file ? 'nvv4l2h264enc + qtmux + filesink' : 'nv3dsink', 'sink', [13, 3.5], file ? 'Output conversion to an encoder-compatible format precedes H.264 encoding, parsing, and MP4 muxing. EOS finalizes the file.' : 'The Jetson sink presents annotated frames using the available display session. Other platforms need their own compatible display sink.', 'Annotated video', file ? 'Annotated MP4 file' : 'Display surface', file ? 'NVIDIA encoder + filesystem' : 'Jetson display', 'Source, sink, parser, and TensorRT engine compatibility must be validated on the target. No native DeepStream process is started here.', REFERENCES.nvidia),
  ]
  return {
    id: backend, name: 'DeepStream', vendor: 'NVIDIA', target: 'Jetson reference pipeline', runtime: 'TensorRT / GPU', memory: 'NVMM + NvDsBatchMeta', nodes,
    links: [link('source', 'convert', 'video', file ? 'H.264 access units' : 'NVMM video'), link('convert', 'queue', 'video', 'NV12 surfaces'), link('queue', 'batch', 'video', 'sink_0 / batch-size=1'), link('batch', 'inference', 'video', 'Video + batch metadata'), link('inference', 'postprocess', 'annotated', 'Video + object metadata'), link('postprocess', 'overlay', 'annotated', 'RGBA + metadata'), link('overlay', 'output', 'annotated', 'Annotated video')],
    tour: ['source', 'queue', 'batch', 'inference', 'postprocess', 'overlay', 'output'],
    prerequisites: ['A supported Jetson / JetPack / DeepStream version combination, or a separately configured dGPU pipeline.', 'A compatible TensorRT model, labels, preprocessing configuration, and detection output parser.', 'NVIDIA plugins visible to gst-inspect-1.0, with matching runtime libraries.', 'Use the installed DeepStream sample first; its detector and configuration are not the workshop YOLO export.', 'Tune and measure on the target. Identical browser timing settings intentionally imply no Qualcomm-versus-NVIDIA speed claim.'],
  }
}

export function deploymentRecipe(settings: Settings): string {
  if (settings.backend === 'imsdk') {
    return [
      '# On the board, inside the unzipped Edge Impulse IM SDK deployment.',
      '# Use the SDK and README supplied with that deployment.',
      'export XDG_RUNTIME_DIR=/dev/socket/weston',
      'export WAYLAND_DISPLAY=wayland-1',
      settings.source === 'camera' ? './run-camera-pipeline.sh' : './run-file-pipeline.sh --in-file input.mp4 --out-file annotated.mp4',
      '',
      '# Inspect factories from the current QIM reference, if installed:',
      'gst-inspect-1.0 qtimltflite',
      'gst-inspect-1.0 qtimlpostprocess',
    ].join('\n')
  }
  return [
    '# On the supported NVIDIA target; not an IM SDK deployment.',
    'gst-inspect-1.0 nvstreammux',
    'gst-inspect-1.0 nvinfer',
    'gst-inspect-1.0 nvdsosd',
    '',
    '# From the installed DeepStream samples directory,',
    '# run a supplied config matching this target and source.',
    '# Replace this path with that validated configuration:',
    'deepstream-app -c /path/to/validated-deepstream-config.txt',
    '',
    '# TensorRT models, labels, and parser libraries are separate assets.',
    '# Browser queue and timing values are NOT native measurements.',
  ].join('\n')
}