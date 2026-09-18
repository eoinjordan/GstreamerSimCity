# Verification And Sources

## What Is Verified

The Node tests cover graph link integrity, unique element IDs, valid tour stages, backend-specific inference contracts and recipes, queue bounds, buffer conservation, leakage direction, upstream blocking, pause, reset, backend switching, EOS, finite files, invalid settings, and frame payload arithmetic.

Production Playwright tests cover both profiles at 1440 x 900 and 390 x 844, plus controls at 320 x 740. They check nonblank canvas pixels, changes after advancing simulation time, projected bounds of every initial-view stage, nonoverlapping labels, document overflow, native page errors, backend reset, source changes, tours, tab keyboard navigation, and JSON export. This is not native SDK validation.

## Arithmetic

- Simulation advances on a 5 ms fixed step. Dividing an advance into smaller calls gives the same result.
- The single inference worker includes a fixed 5 ms preprocessing allowance plus the user-selected inference time. Completions are observed on the next 5 ms boundary.
- A separate fixed 5 ms output allowance follows inference. This can overlap the next inference job.
- Queue capacity excludes the processing frame, the output frame, and one blocked producer frame.
- `produced = completed + dropped + inFlight` throughout the model.
- A full non-leaky queue retains a pending producer frame and blocks source production until space returns. Sensor/driver losses outside this model are not estimated.
- `leaky=upstream` drops the new incoming buffer; `leaky=downstream` drops the oldest waiting buffer. Neither discards an already-processing frame.
- Displayed latency is the mean production-to-output age of the last 60 completed frames. Output rate is the count of completions in the last simulated second; startup fills that window.
- The trace keeps 100 samples at 250 ms intervals, or 25 seconds.
- File mode produces 300 synthetic frames, requests EOS, and drains accepted work. EOS does not abruptly discard queued frames.
- A tightly packed 1280 x 720 NV12 frame contains `1280 * 720 * 3 / 2 = 1,382,400` bytes (about 1.32 MiB). RGBA is `width * height * 4`. Allocator stride, padding, pools, and metadata are excluded.

NULL and READY clear resources; PAUSED freezes the model clock. Native preroll, asynchronous state transitions, live-source NO_PREROLL, and pipeline-clock selection are not reproduced. Model event rows are explanatory records, not captured bus messages.

## Architecture Boundaries

The IM SDK graph uses a video branch plus a tensor/metadata branch. Only its inference queue is numerically simulated. The raw-video queue, metadata matching, and sink synchronization are structural context, not additional simulated scheduling threads.

DeepStream `nvinfer` consumes batched video and attaches inference metadata; it does not send a standalone tensor stream to the OSD. A green connection means video carrying results, not that bounding boxes have already been drawn. Drawing happens in the overlay stage.

Packet travel and building motion are scaled for visibility, not wall-clock service times or one-packet-per-buffer traces. Synthetic boxes are generated graphics, not model predictions. No model, runtime, power sensor, performance counter, or native camera is accessed.

Current QIM references and the workshop's IM SDK deployment are different version surfaces. Factory names, metadata formats, delegates, and labels must be checked against the installed SDK and exported model. Neither QNN presence nor a TensorRT-compatible target proves all operations execute on the intended accelerator.

## Primary References

Reviewed 2026-09-17. These sources establish contracts, not the app's simulated timing coefficients.

| Source | Used For |
| --- | --- |
| [Multi-Solutions Workshop](https://github.com/eoinjordan/multisolutions_workshop) | QCS6490 context, camera/file wrappers, Wayland environment, and verification-first methodology |
| [Edge Impulse IM SDK deployment](https://docs.edgeimpulse.com/hardware/deployments/run-qualcomm-im-sdk-gstreamer) | Exported bundle layout, YOLO-only deployment restriction, and supported wrapper commands |
| [Qualcomm QIM AI pipelines](https://imsdkdocs.qualcomm.com/sample-pipelines/aipipelines) | Current object-detection graph, QNN external delegate, metadata merge and overlay |
| [Qualcomm plugin reference](https://imsdkdocs.qualcomm.com/plugin-reference/introduction) | Current factory names and plugin roles |
| [DeepStream sample applications](https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_C_Sample_Apps.html) | Decoder, stream mux, primary GIE, OSD, and renderer pipeline |
| [Gst-nvinfer](https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_plugin_gst-nvinfer.html) | TensorRT inference and attached metadata |
| [Gst-nvstreammux](https://docs.nvidia.com/metropolis/deepstream/dev-guide/text/DS_plugin_gst-nvstreammux.html) | Batch construction and requested sink pads |
| [GStreamer queue](https://gstreamer.freedesktop.org/documentation/coreelements/queue.html) | Buffer bounds, blocking, leakage policies, and streaming-thread separation |
| [GStreamer tee](https://gstreamer.freedesktop.org/documentation/coreelements/tee.html) | Branching and the need for separate branch queues |

Native execution on Qualcomm and NVIDIA hardware remains unverified. Browser test success must not be presented as successful QNN, TensorRT, or GStreamer execution.