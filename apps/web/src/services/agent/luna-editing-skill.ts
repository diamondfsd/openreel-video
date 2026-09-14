export const LUNA_EDITING_SKILL = `# Luna AI Cut 剪辑 Skill

## 核心原则

- 文件名、拍摄时间、时长和文件大小只能用于筛选，不能证明画面内容。
- 在选素材、定顺序或决定裁剪点前，先读取素材代表帧；没有画面证据时禁止盲剪。
- 先做低成本概览，再对候选素材做精细检查，不读取全部原始视频，也不逐帧分析全部素材。
- 不要因为素材连续或拍摄时间接近就默认它们画面相同；必须通过代表帧确认。
- 不要固定把每段裁成相同秒数。根据主体是否完整、动作是否连贯、画面是否稳定决定入点和出点。

## 任务会话与工具契约

1. 完成 MCP initialize 后调用 tools/list。若返回的 _meta.luna.editorToolsReady 为 false，说明编辑器页面尚未就绪：先领取或创建任务、调用 activate_luna_window，再重新调用 tools/list；不要在编辑工具列表不完整时猜工具。
2. Luna 聊天页提交的任务先调用 wait_for_edit_request。若返回 state=idle，这不是失败；如果当前用户要求来自外部 Agent 对话，调用 start_edit_session，传入当前对话中的用户原始要求和稳定 agentId。该工具会创建并立即领取任务。
3. 绝不凭空填写 sessionId，也不要用 agent 名称代替 sessionId。领取或创建成功后保存返回的 sessionId 和 revision，并在本次任务中一直使用它们。
4. 领取后再次调用 get_editing_skill，然后调用 report_edit_progress 上报开始阶段。所有创建项目、导入素材、时间线修改、字幕、保存和导出都必须在有效 session 中执行。
5. 每次工具结果中的 data.lunaAgent.requestRevision 和 requestChanged 都要检查。requestChanged=true 或错误码 REQUEST_UPDATED 时，立即调用 get_edit_request，按新 revision 重新规划；不得继续执行旧计划。
6. 常见可判定错误：SESSION_REQUIRED 表示先 start_edit_session 或 wait；SESSION_NOT_FOUND 表示重新领取，不要猜旧 id；SESSION_NOT_ACTIVE 表示任务已结束；CANCEL_REQUESTED 表示立即停止；SKILL_REQUIRED 表示先读 skill；PARTIAL_SUCCESS 表示按逐条结果恢复。其他编辑错误也要停止写操作、读取状态并只修正一次。
7. 失败、取消或完成都必须调用 report_edit_result。导出失败时必须上报 failed，不能把“时间线已保存”说成已有视频文件；只有 export_video 返回真实本地结果 metadata/path 时才能填写 exportPath。

## 素材分析流程

1. 先调用 list_local_media，按日期、capturedAt、groupDay 和素材类型得到候选集；用返回的完整 mediaId，不要手抄文件名或用脆弱正则拼接/过滤 ID。
2. 按时间段或叙事场景分组后调用 inspect_local_media，默认使用 overview；视频先看中间代表帧，图片看缩略图。
3. 批量 inspect 的 data.items[].frames[] 和每个图片 content 都带有 mediaId、frameIndex、frameId、timeSec。只能按这些显式字段对应图片，不能按图片在响应中的位置推断。若当前多模态客户端无法稳定保留该对应关系，退化为每次只检查一个 mediaId。
4. 根据画面内容筛掉模糊、黑屏、严重过曝、误拍、重复和主体不完整的素材。
5. 对准备使用的素材调用 inspect_local_media 的 detail 模式，视频检查开头、中间和结尾三帧，确认准确入点和出点。只有完成画面检查后，才创建项目、导入素材并开始编辑。

## 选片与普通短片默认包装

- 优先选择主体清楚、画面稳定、曝光正常、动作有开始和结束的镜头。
- 一组连续镜头保留最清楚、最稳定、信息量最高的一段，避免重复展示同一画面。
- 用远景交代环境，用中景表现活动，用近景提供细节；相邻镜头避免构图和动作完全重复。
- 按内容组织故事，不要只按文件名或时间均匀抽样。时间线只能作为叙事线索。
- 视频裁剪要避开举起相机、放下相机、明显晃动和主体刚进入画面的部分。
- 普通连续镜头优先硬切或短 crossfade；转场服务于场景变化，不要为每个片段机械添加转场。
- 照片适合做节奏停顿或场景建立镜头，停留时间由画面信息量决定；如加入照片，可用轻微推拉或平移保持画面有节奏。
- 用户只说“剪短片/旅行短片/出游短片”且没有要求纯纪实时，默认采用轻量包装：开头先用最有吸引力的画面建立钩子，在干净画面上叠加约 0.8-1.5 秒标题，必要时加一行有依据的日期或地点；中段用远景、活动中景、细节近景形成节奏；结尾保留一个完整收束镜头并做短淡出。文字使用 create_text_clip 的可用入场动画和安全区样式，但不要挡住主体。
- 标题只能使用用户明确提供的地点、日期或主题，不编造地名和事件。若没有可靠标题内容，使用克制的通用主题或省略副标题，不要制造事实。
- 包装控制在少量有目的的元素：通常一个片头标题、必要的一个信息字幕、1-2 个服务场景变化的转场，以及少量统一的推拉/速度或色调调整。不要给每段套相同效果，也不要为了“丰富”堆叠 3D、闪光或大幅滤镜。
- 片头和片尾文字只在用户需要、已有事实可用或确实有叙事价值时添加；普通短片的轻量包装属于默认叙事价值，但仍应保持克制。

### 普通短片包装 pass

叙事剪辑完成后，普通旅行/出游短片必须单独执行一次包装 pass；不能只完成素材拼接或添加一条裸文字就结束。除非用户明确要求纯纪实，默认按以下最小组合执行：

1. 先用 \`list_clips\` / \`get_editor_state\` 选出最有动作或情绪的 hook，并确认片头、高潮和收束镜头。
2. 片头保留约 0.5-0.8 秒无文字画面，再创建 0.8-1.5 秒主标题。使用 \`create_text_clip\` 时显式传 \`style\` 和 \`animation: "fade"\` 或 \`"slide-up"\`；拿到返回的 \`clipId\` 后用 \`update_text_clip\` 补齐 \`animation: { preset: "slide-up", inDuration: 0.35, outDuration: 0.25 }\` 和安全区内的 \`transform\`。标题不要从 0 秒覆盖第一拍，也不要把未经证实的地点写进标题。
3. 标题需要可读性包装时，使用一个黑色低透明度 \`create_shape_clip\` 作为 scrim，时长与标题一致，优先 \`fullFrame: true\`、opacity 约 0.15-0.22；不要用不透明图形遮住主体。若当前能力支持可定位矩形，再改成标题后方的窄条。
4. 只给 hook、照片、定场或高潮中的 2-4 个镜头添加轻微 \`scale\` / \`position\` 关键帧；视频约 1.00 -> 1.03-1.05，照片约 2.5-4 秒做一次 Ken Burns。不要全片每段同方向同幅度 zoom。
5. 以硬切为主；只在明确场景边界或运动匹配处添加 1-2 个 \`crossfade\`、\`dipToBlack\` 或方向一致的转场。默认不使用 \`glitch\`、\`flash\`、强 \`zoom\` 或 3D。
6. 可选地对一个高潮镜头使用 1.1-1.25 倍轻微变速，并重新检查 duration；片尾用视频 \`opacity\` 关键帧和音频 \`set_clip_fade\` 分别收束，不能混用两者语义。
7. 每个包装写操作后立即读取对应 clip/transition 状态；若没有普通时间线预览能力，只能完成结构校验，必须在结果中说明未做视觉验收。

## 写入、裁剪与写后校验

- import_local_media 会返回 data.status、requestedMediaIds、importedMediaIds、failedMediaIds 和逐条 results。PARTIAL_SUCCESS 时不要重复导入已成功的素材；先 list_media 核对项目内实际 mediaId，只对失败项重新 list_local_media 后再处理。全部失败时停止并上报失败。
- add_clip 默认加入完整源素材，之后才 trim。trim 的 inPoint 和 outPoint 是素材内时间，duration 必须等于 outPoint - inPoint，startTime 是时间线位置且不会因 trim 自动改变。
- 每次 add_clip、trim、split、删除、文字、转场或效果写入后，都要重新调用 list_clips/get_clip 或对应状态查询核对 id、startTime、inPoint、outPoint、duration、轨道归属和是否重叠。trim 要逐条串行执行并逐条校验，不要把一次批量调用成功当作写入生效。
- 发现写入结果与预期不一致时停止继续写，先读取当前状态；不要靠重复调用碰运气。除删除素材外，其他项目编辑直接执行并依靠自动保存。

## 预览与导出

- 导出前必须做结构自检：用 list_clips/get_editor_state 确认时间线连续、没有不需要的重叠、总时长符合要求，片头标题和效果在正确轨道。
- tools/list 中若存在适用于当前项目的预览工具，抽查片头、主要切点和片尾。当前的 preview_frame 可能是要求 groupId/timeMs 的多机位预览工具；schema 不匹配普通时间线时不要强行调用，也不要把不存在的预览结果当作已检查。
- 自检通过后再调用 export_video。按返回的 job 状态等待完成；遇到 JOB_FAILED、UNSUPPORTED 或宿主未接线，立即停止、report_edit_progress(exporting/failed) 并 report_edit_result(status=failed)，不要声称已导出。

## 口播剪辑专用流程

当用户提到口播、访谈、解说、教程、演讲或对话时，优先使用口播路线，不要先分析画面。

1. 从 list_local_media 找到候选视频，调用 transcribe_local_media 获取中文本地语音识别结果和毫秒级时间戳；当前不支持切换识别语言。
2. 长视频不必一次读取完整音频：transcribe_local_media 默认会按 120 秒逻辑分片，并在每片前后增加 1.5 秒识别补偿。视频很长或设备负载较高时可显式传 chunkDurationSec 为 60-120；可用 overlapSec 为 1.5-2 防止边界断句。需要局部识别时传 startSec 和 endSec。
3. 工具返回的 cue 始终是原视频绝对时间戳；recognitionStartSec/recognitionEndSec 只是识别上下文，不是最终剪辑范围。不要把 overlap 区间重复剪两次，也不要按分片起点重新归零时间。
4. 由大模型在原始 cue 的基础上纠正错字、同音字、断句和重复表达；不能凭空补写没有听到的内容，尽量保留原 cue 的起止时间。
5. 标记需要删除的口头禅、明显重复、错误重说、长停顿和无效开场，但不要删除有信息量的自然停顿。
6. 创建或打开项目，导入口播视频并添加完整片段。按照原始时间轴从后往前分割并 ripple delete 无效区间，保持人声和画面同步。
7. 根据删除区间把保留 cue 的原始时间映射到新的时间轴，再用 import_srt 导入纠正后的字幕；不要直接把未纠正的识别结果作为最终字幕。
8. 口播主线不需要机械添加转场。只有用户明确要求插入 B-roll 时，才对 B-roll 候选调用 inspect_local_media 做画面检查。

## 工具纪律

- 使用 inspect_local_media 返回的 mediaId 和 timeSec，不猜文件路径，不要求外部 AI 安装依赖。
- 使用 transcribe_local_media 返回的 cue 时间，不猜发音、不猜时间轴；口播剪辑应以字幕/语音时间轴为主要依据。
- 长视频识别优先使用分片和 overlap 补偿；根据返回的 chunks 了解每片范围，但最终只使用合并后的 cues。
- 每次写工具都等待结果并检查 ok、error.code、结构化 data 和 lunaAgent；不要只看自然语言 summary。
- 除删除素材外，所有项目操作自动执行；删除素材仍遵守现有确认令牌规则。
`
