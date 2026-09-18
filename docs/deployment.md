# On-Device Deployment

GStreamer SimCity switches **reference profiles**. Actual deployment requires platform-specific plugins, compatible model exports, and an installed runtime. It is not possible to replace `qtimltflite` with `nvinfer` in an arbitrary pipeline and keep the same caps, metadata, and model assets.

## Qualcomm: The Workshop Path

The [workshop launch script](https://github.com/eoinjordan/multisolutions_workshop/blob/main/scripts/04-run-gstreamer-pipeline.sh) runs the camera/file scripts inside the Edge Impulse deployment ZIP. It does not define the plugin graph itself.

1. Set up the QCS6490 board with the workshop instructions for its OS.
2. Validate the QNN backend and library paths. Profile layer placement and confirm the intended HTP execution rather than relying on the board's NPU specification.
3. Build **Qualcomm IM SDK GStreamer pipeline** in Edge Impulse Studio. This deployment option supports YOLO-based object detection models.
4. Transfer and unzip the deployment on the board. Read that bundle's README and use its model, labels, binaries, and generated scripts together.
5. Confirm the display environment or choose file output.

For the workshop's Wayland image, from inside the deployment directory:

```bash
export XDG_RUNTIME_DIR=/dev/socket/weston
export WAYLAND_DISPLAY=wayland-1
./run-camera-pipeline.sh
```

For an MP4 input and annotated output:

```bash
./run-file-pipeline.sh --in-file input.mp4 --out-file annotated.mp4
```

Display variables must match the actual image/session. A different OS or Weston configuration may use different values.

### Current QIM Versus Older IM SDK Bundles

The current [Qualcomm reference](https://imsdkdocs.qualcomm.com/sample-pipelines/aipipelines) describes `qtimlvconverter`, `qtimltflite`, `qtimlpostprocess`, `qtimetamux`, and `qtivoverlay` for object detection. It uses the QNN external LiteRT delegate when HTP is requested. These names drive the app's current reference graph.

Older exports based on IM SDK 2.x may use different camera factories, detection elements, composer arrangements, or label formats. Do not rewrite a working export solely to match this visualization. `gst-inspect-1.0 <factory>` on the target and the deployed SDK's documentation decide what is actually available.

`qtivcomposer` composes multiple video inputs. It is not the metadata mux and is not needed in the single annotated-video reference shown here.

## NVIDIA: DeepStream

Use a supported Jetson/JetPack/DeepStream combination. The camera profile is Jetson-specific (`nvarguscamerasrc` and `nv3dsink`); a discrete GPU needs a compatible source/sink configuration.

Start with the installed DeepStream sample application and its supplied configuration and model. Validate the installation:

```bash
gst-inspect-1.0 nvstreammux
gst-inspect-1.0 nvinfer
gst-inspect-1.0 nvdsosd
```

Then run a configuration that is valid for that target:

```bash
deepstream-app -c /path/to/validated-deepstream-config.txt
```

The path above is intentionally a placeholder, not a supplied executable configuration. It must specify the actual source, sink, model, and installed libraries.

To port the workshop's detection task, export a model supported by the installed TensorRT version, configure matching preprocessing, labels, and output parsing, and validate the results against the original model. A TFLite file and its IM SDK labels are not interchangeable with a TensorRT engine and DeepStream parser configuration. Engines can depend on the GPU and TensorRT build; build or validate them on the intended target.

The app uses one source and `batch-size=1`. Multiple sources require proper requested sink pads, compatible batch settings, and version-appropriate timeout/synchronization behavior. The new and legacy `nvstreammux` implementations are not identical.

## Measure Separately

For both SDKs, measure end-to-end latency, output cadence, queue levels, dropped frames, and accelerator placement on the target. Inspect negotiated caps and allocator behavior before claiming zero-copy. Use native GStreamer tracing and vendor profiling tools; simulated browser values are not a substitute.

The JSON download contains a labelled simulation configuration, reference graph, counters, and trace. It does not contain a native pipeline, trained model, target measurements, or credentials.