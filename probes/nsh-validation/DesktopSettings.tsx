import { effect, keymap, signal, Scroll, Text, View, windowSize, type Bounds, type ViewStyle } from 'nsh';
import { Button, Dialog, Input, Menu, MenuItem, Radio, RadioGroup, Toggle } from 'nsh/base';
import type { Calls, ModelConfig, SavedService, ServiceConfig } from './desktop-contract';
import { DesktopIcon } from './DesktopIcon';
import { desktopTheme as t } from './desktop-theme';
import { controlFocus, controlHover, controlPressed, controlSurface } from './desktop-control-style';

const appearances = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
] as const;
export type DesktopAppearance = typeof appearances[number]['id'];

type SettingsProps = {
  onClose: () => void;
  dark: boolean;
  art: boolean;
  appearance: DesktopAppearance;
  onAppearance: (appearance: DesktopAppearance) => void;
  characters: boolean;
  onCharacters: (show: boolean) => void;
  statistics: boolean;
  onStatistics: (show: boolean) => void;
  defaultModel?: string;
  onModels?: (params: Calls['models.manage']['params']) => Promise<Calls['models.manage']['result']>;
  onLayout?: (event: { bounds: Bounds }) => void;
};

function Preference(props: { id: string; label: string; description: string; checked: boolean; disabled?: boolean;
  color: string; muted: string; onChange: (checked: boolean) => void }) {
  return <Toggle testID={props.id} pressed={props.checked} disabled={props.disabled}
    accessibilityLabel={props.label} onChange={event => props.onChange(event.pressed)}
    hoverStyle={controlHover} focusVisibleStyle={controlFocus}
    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 9 }}>
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
      <Text style={{ fontFamily: t.fontFamily, fontSize: 13, color: props.color }}>{props.label}</Text>
      <Text style={{ fontFamily: t.fontFamily, fontSize: 12, lineHeight: 17, color: props.muted }}>{props.description}</Text>
    </View>
    <View style={{ width: 42, height: 23, borderRadius: 12, padding: 3, justifyContent: 'center', flexShrink: 0,
      alignItems: props.checked ? 'flex-end' : 'flex-start', backgroundColor: props.checked ? '#365891' : '#63759488',
      borderWidth: 1, borderColor: props.checked ? '#c8ab72' : '#8094b580' }}>
      <View style={{ width: 15, height: 15, borderRadius: 8, backgroundColor: props.checked ? '#f2ddb1' : '#e0e8f6' }} />
    </View>
  </Toggle>;
}

const efforts = [
  ['off', '关闭'], ['minimal', 'Minimal'], ['low', 'Low'], ['medium', 'Medium'],
  ['high', 'High'], ['xhigh', 'Extra High'], ['max', '最高'],
] as const;
const types = [['openai', 'OpenAI 兼容'], ['glm', 'GLM Coding Plan']] as const;
const apis = [['openai-responses', 'Responses'], ['openai-completions', 'Chat Completions']] as const;
const newService = (): ServiceConfig => ({ id: null, name: '', baseUrl: '', service: 'openai', api: 'openai-responses' });
const newModel = (): ModelConfig => ({ id: null, label: '', model: '', contextWindow: 128000,
  maxTokens: 8192, imageInput: false, efforts: ['off'], defaultEffort: 'off' });

function ModelServices(props: { dark: boolean; defaultModel?: string; onModels: NonNullable<SettingsProps['onModels']> }) {
  const services = signal<SavedService[]>([]);
  const selectedId = signal<string | null>(null), loading = signal(true), editing = signal(false);
  const detail = () => {
    const group = services().find(service => service.models.some(model => model.id === selectedId()));
    const model = group?.models.find(item => item.id === selectedId());
    return group && model ? { service: group, model } : null;
  };
  const form = signal({ service: newService(), model: newModel() });
  const key = signal(''), saving = signal(false), message = signal('');
  const textColor = () => props.dark ? '#e7edfa' : '#172b50';
  const surface = () => props.dark ? '#122144' : '#edf2fc';
  const text = () => ({ fontFamily: t.fontFamily, fontSize: 13, color: textColor() });
  const control = () => ({ ...controlSurface, backgroundColor: surface(), borderWidth: 1, borderColor: '#8a9dc76b', borderRadius: 8 });
  const changeService = (value: Partial<ServiceConfig>) => {
    const current = form();
    form.set({ ...current, service: { ...current.service, ...value } });
  };
  const changeModel = (value: Partial<ModelConfig>) => {
    const current = form();
    form.set({ ...current, model: { ...current.model, ...value } });
  };
  const edit = (service?: ServiceConfig, model?: ModelConfig) => {
    const setup = service ?? newService();
    form.set({ service: { id: setup.id, name: setup.name, baseUrl: setup.baseUrl, api: setup.api, service: setup.service },
      model: model ?? newModel() });
    key.set(''); message.set(''); editing.set(true);
  };
  const finish = () => { editing.set(false); key.set(''); };
  effect(() => {
    void props.onModels({ action: 'list' }).then(value => {
      const models = value.services.flatMap(service => service.models);
      selectedId.set(models.find(model => model.id === value.models.defaultId)?.id ?? models[0]?.id ?? null);
      services.set(value.services);
    }).catch(() => message.set('读取模型服务失败')).finally(() => loading.set(false));
  });
  async function save() {
    const value = form();
    if (!editing() || saving()) return;
    const { service, model } = value;
    if (!service.name.trim() || !service.baseUrl.trim() || !model.model.trim() || (!service.id && !key().trim())) {
      message.set('请填写服务名称、地址、模型 ID 和 API 密钥。');
      return;
    }
    saving.set(true);
    try {
      const result = await props.onModels({ action: 'save', service: { ...service, apiKey: key().trim() },
        model: { ...model, model: model.model.trim(), label: model.label.trim() || model.model.trim() } });
      const savedService = result.services.find(item => service.id ? item.id === service.id :
        !services().some(previous => previous.id === item.id));
      const savedModel = savedService?.models.find(item => model.id ? item.id === model.id : item.model === model.model.trim());
      services.set(result.services);
      selectedId.set(savedModel?.id ?? selectedId());
      finish(); message.set('模型已保存，可以在输入框中选择。');
    } catch { message.set('保存失败。请检查 HTTPS 地址、模型参数和服务支持的推理档位。'); }
    finally { saving.set(false); }
  }
  const action = (id: string, label: string, onPress: () => void, disabled = false, selected = false) =>
    <Button testID={id} onPress={onPress} selected={selected} disabled={disabled} disabledStyle={{ opacity: .48 }}
      style={{ ...control(), ...(selected && { borderColor: '#b89961', backgroundColor: props.dark ? '#354c78' : '#d5e0f5' }),
        paddingHorizontal: 9, paddingVertical: 5, minHeight: 32, justifyContent: 'center' }}
      hoverStyle={controlHover} focusVisibleStyle={controlFocus}><Text class="line-clamp-2" style={text()}>{label}</Text></Button>;
  const input = (id: string, label: string | (() => string), value: () => string, change: (text: string) => void, masked = false) => {
    const name = () => typeof label === 'string' ? label : label();
    return <View style={{ gap: 4 }}>
      <Text style={text()}>{name()}</Text>
      <Input testID={id} accessibilityLabel={name()} masked={masked} autoCorrect={false} autoCapitalize="none" maxLength={masked ? 4096 : 2048}
        style={{ ...control(), ...text(), paddingHorizontal: 9, height: 34 }} value={value()} onChange={e => change(e.value)} />
    </View>;
  };
  function select<Id extends string>(label: string, value: Id, options: readonly (readonly [Id, string])[], update: (id: Id) => void) {
    return <View style={{ gap: 4 }}>
      <Text style={text()}>{label}</Text>
      <Menu popupStyle={{ ...control(), padding: 4, minWidth: 160 }}
        trigger={<Button accessibilityLabel={label} style={{ ...control(), height: 34, paddingHorizontal: 9,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }} hoverStyle={controlHover}>
          <Text style={text()}>{options.find(([id]) => id === value)?.[1] ?? value}</Text>
          <DesktopIcon name="chevronDown" color={textColor()} size={14} />
        </Button>}>
        {options.map(([id, name]) => <MenuItem onSelect={() => update(id)} style={{ padding: 8, borderRadius: 6 }} hoverStyle={controlHover}>
          <Text style={text()}>{name}</Text></MenuItem>)}
      </Menu>
    </View>;
  }
  const allowed = () => efforts.filter(([id]) => {
    const group = form().service;
    return group.service !== 'glm' || (group.api === 'openai-responses' ? ['off', 'low', 'high', 'max'].includes(id) : id === 'off');
  });
  function updateProtocol(value: Partial<ServiceConfig>) {
    changeService(value);
    const current = form().model;
    const supported = current.efforts.filter(e => allowed().some(([id]) => id === e));
    changeModel({ efforts: supported.length ? supported : ['off'], defaultEffort: supported.includes(current.defaultEffort) ? current.defaultEffort : supported[0] ?? 'off' });
  }
  const item = (label: string, value: string) => <View style={{ gap: 3 }}>
    <Text style={{ ...text(), opacity: .75, fontSize: 12 }}>{label}</Text>
    <View selectable><Text style={text()}>{value}</Text></View>
  </View>;
  const effortName = (id: string) => efforts.find(option => option[0] === id)?.[1] ?? id;
  return <View testID="model-services" style={{ flexDirection: 'row', flex: 1, minHeight: 0 }}>
    <View style={{ width: Math.min(220, Math.max(148, windowSize().width * .24)), borderRightWidth: 1,
      borderColor: '#8a9dc75c', paddingHorizontal: 12, paddingTop: 15, paddingBottom: 8, gap: 10 }}>
      <Text style={{ ...text(), fontWeight: '600', fontSize: 15 }}>模型列表</Text>
      {action('settings-add-model', '添加模型', () => edit(), loading() || saving())}
      <Scroll testID="settings-model-list" style={{ flex: 1, minHeight: 0 }} contentStyle={{ gap: 13 }}>
        {services().map(service => <View style={{ gap: 5 }}>
          <Text class="line-clamp-2" style={{ ...text(), fontWeight: '600' }}>{service.name}</Text>
          {service.models.map(model => action(`settings-model-${model.id}`, model.label, () => {
            finish(); message.set(''); selectedId.set(model.id);
          }, saving(), !editing() && selectedId() === model.id))}
          {action(`settings-add-model-${service.id}`, '在此服务添加模型', () => edit(service), saving())}
        </View>)}
      </Scroll>
    </View>
    <Scroll testID="settings-model-details-scroll" style={{ flex: 1, minWidth: 0, minHeight: 0 }}
      contentStyle={{ padding: 17, gap: 12 }}>
    {!editing() && (detail() ? <View testID="settings-model-detail" style={{ gap: 10 }}>
      <Text style={{ ...text(), fontWeight: '600', fontSize: 18 }}>{detail()!.model.label}</Text>
      {item('模型 ID', detail()!.model.model)}
      {item('模型服务', detail()!.service.name)}
      {item('服务地址', detail()!.service.baseUrl)}
      {item('服务类型', types.find(([id]) => id === detail()!.service.service)?.[1] ?? detail()!.service.service)}
      {item('API 协议', apis.find(([id]) => id === detail()!.service.api)?.[1] ?? detail()!.service.api)}
      {item('上下文窗口', detail()!.model.contextWindow.toLocaleString())}
      {item('最大输出 Token', detail()!.model.maxTokens.toLocaleString())}
      {item('图片输入', detail()!.model.imageInput ? '已开启' : '关闭')}
      {item('可选推理强度', detail()!.model.efforts.map(effortName).join(' · '))}
      {item('默认推理强度', effortName(detail()!.model.defaultEffort))}
      {action('settings-edit-model', '编辑模型', () => {
        const selected = detail();
        if (selected) edit(selected.service, selected.model);
      })}
    </View> : <View style={{ gap: 6 }}>
      <Text style={{ ...text(), fontWeight: '600', fontSize: 16 }}>{loading() ? '正在读取模型' : '模型详情'}</Text>
      {!loading() && !message() && <Text style={text()}>添加模型后可在这里查看配置。</Text>}
    </View>)}
    {!editing() && <Text testID="settings-default-model" style={{ ...text(), opacity: .75 }}>默认模型 · {props.defaultModel ?? '暂未提供'}</Text>}
    {editing() && <View testID="model-form" style={{ gap: 8 }}>
      <Text style={{ ...text(), fontWeight: '600' }}>{form().model.id ? '编辑模型' : form().service.id ? '为现有服务添加模型' : '添加模型服务'}</Text>
      {input('model-service-name', '服务名称', () => form().service.name, name => changeService({ name }))}
      {input('model-service-url', '服务地址', () => form().service.baseUrl, baseUrl => changeService({ baseUrl }))}
      {select('服务类型', form().service.service, types, service => updateProtocol({ service }))}
      {select('API 协议', form().service.api, apis, api => updateProtocol({ api }))}
      {input('model-api-key', () => form().service.id ? 'API 密钥（留空保留）' : 'API 密钥', key, key.set, true)}
      {input('model-id', '模型 ID', () => form().model.model, model => changeModel({ model }))}
      {input('model-label', '显示名称（选填）', () => form().model.label, label => changeModel({ label }))}
      {input('model-context', '上下文窗口', () => String(form().model.contextWindow || ''), value => changeModel({ contextWindow: Number(value) || 0 }))}
      {input('model-max-output', '最大输出 Token', () => String(form().model.maxTokens || ''), value => changeModel({ maxTokens: Number(value) || 0 }))}
      <Preference id="model-image-input" label="图片输入" description="为已验证支持图片的模型开启" checked={form().model.imageInput}
        color={textColor()} muted={textColor()} onChange={imageInput => changeModel({ imageInput })} />
      <Text style={text()}>可选推理强度</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
        {allowed().map(([id, name]) => <Toggle testID={`model-effort-${id}`} accessibilityLabel={name}
          pressed={form().model.efforts.includes(id)} style={{ ...control(), padding: 7 }} pressedStyle={{ borderColor: '#c5a468', backgroundColor: props.dark ? '#354c78' : '#d5e0f5' }}
          onChange={e => {
            const model = form().model;
            const next = e.pressed ? [...model.efforts, id] : model.efforts.filter(v => v !== id);
            if (next.length) changeModel({ efforts: next, defaultEffort: next.includes(model.defaultEffort) ? model.defaultEffort : next[0] });
          }}><Text style={text()}>{name}</Text></Toggle>)}
      </View>
      {select('默认推理强度', form().model.defaultEffort, efforts.filter(([id]) => form().model.efforts.includes(id)), defaultEffort => changeModel({ defaultEffort }))}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {action('settings-cancel-model', '取消', finish, saving())}
        {action('settings-save-model', saving() ? '正在保存…' : '保存模型', () => void save(), saving())}
      </View>
    </View>}
    {!!message() && <Text testID="model-service-message" style={text()}>{message()}</Text>}
    </Scroll>
  </View>;
}

export function DesktopSettings(props: SettingsProps) {
  keymap.bind('escape', props.onClose, { when: 'always' });
  const ink = () => props.dark ? '#f4eddd' : '#172b50';
  const muted = () => props.dark ? '#b9c8e3' : '#485d7e';
  const gold = () => props.dark ? '#e5c991' : '#76542b';
  const card = (): ViewStyle => ({ padding: 5, gap: 3, borderRadius: 12, borderWidth: 1,
    backgroundColor: props.dark ? '#101f3eba' : '#f7faffc7', borderColor: props.dark ? '#7c93c04a' : '#8a9dc75c' });

  const section = signal<'models' | 'appearance'>('models');
  const width = () => Math.max(0, Math.min(props.onModels ? 884 : 520, windowSize().width - 32));
  const height = () => Math.max(0, Math.min(props.onModels ? 660 : 492, windowSize().height - 52));
  const appearanceSettings = () =>
        <View style={{ gap: 8 }}>
          <Text style={{ fontFamily: t.fontFamily, color: gold(), fontSize: 14, fontWeight: '600' }}>外观与显示</Text>
          <View style={card()}>
            <View style={{ padding: 10, gap: 7 }}>
              <Text style={{ fontFamily: t.fontFamily, color: ink(), fontSize: 13 }}>界面颜色</Text>
              <RadioGroup style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                {appearances.map(option => <Radio testID={`settings-appearance-${option.id}`} checked={props.appearance === option.id}
                  onChange={() => props.onAppearance(option.id)} hoverStyle={controlHover} focusVisibleStyle={controlFocus}
                  style={{ ...controlSurface, borderWidth: 1, borderColor: 'transparent', minHeight: 32, justifyContent: 'center', paddingHorizontal: 10 }}
                  checkedStyle={{ backgroundColor: props.dark ? '#395689' : '#cdddf5', borderColor: '#c2a272' }}>
                  <Text style={{ fontFamily: t.fontFamily, color: ink(), fontSize: 12 }}>{option.label}</Text>
                </Radio>)}
              </RadioGroup>
            </View>
            <Preference id="settings-characters" label="人物装饰" description={props.art ? '显示工作台两侧及侧栏的人物插画' : '当前预览未加载人物素材'}
              checked={props.art && props.characters} disabled={!props.art} onChange={props.onCharacters} color={ink()} muted={muted()} />
            <Preference id="settings-statistics" label="输入栏会话统计" description="显示轮数、工具步数、缓存命中和上下文"
              checked={props.statistics} onChange={props.onStatistics} color={ink()} muted={muted()} />
          </View>
        </View>;
  const appearanceNote = () =>
    <Text style={{ fontFamily: t.fontFamily, color: muted(), fontSize: 11, lineHeight: 16 }}>显示设置即时生效，仅在本次运行中保留。</Text>;

  return <Dialog testID="desktop-settings-dialog" accessibilityLabel="设置" animation="none"
    closeOnEscape={false}
    onOpenChange={event => { if (!event.open) props.onClose(); }}
    backdropTestID="settings-backdrop" backdropStyle={{ backgroundColor: '#070f2566' }}
    style={{ position: 'absolute', left: (windowSize().width - width()) / 2, top: (windowSize().height - height()) / 2,
      width: width(), height: height(),
      overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: '#bd9a5a',
      backgroundColor: props.dark ? '#182850' : '#ebf0fa',
      backgroundImage: props.dark ? 'linear-gradient(160deg, #223761, #142447)' : 'linear-gradient(160deg, #f0f4fb, #dbe6f7)',
      boxShadow: '0 16px 52px #060f2b65' }}>
    <View testID="settings-content" onLayout={props.onLayout} style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 20, paddingVertical: 14,
        borderBottomWidth: 1, borderColor: props.dark ? '#cfac6d55' : '#a77b434d' }}>
        <DesktopIcon name="settings" color={gold()} size={19} />
        <Text style={{ fontFamily: t.fontFamily, flex: 1, color: ink(), fontSize: 21, fontWeight: '600' }}>设置</Text>
        <Button testID="settings-close" accessibilityLabel="关闭设置" onPress={props.onClose}
          hoverStyle={controlHover} activeStyle={controlPressed} focusVisibleStyle={controlFocus}
          style={{ ...controlSurface, paddingHorizontal: 12, height: 32, justifyContent: 'center' }}>
          <Text style={{ fontFamily: t.fontFamily, fontSize: 12, color: ink() }}>关闭</Text>
        </Button>
      </View>
      {props.onModels ? <View style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
        <View testID="settings-navigation" style={{ width: Math.min(154, Math.max(108, windowSize().width * .16)),
          padding: 10, gap: 6, borderRightWidth: 1, borderColor: '#8a9dc75c' }}>
          {([['models', '模型'], ['appearance', '外观与显示']] as const).map(([id, label]) =>
            <Button testID={`settings-section-${id}`} selected={section() === id} onPress={() => section.set(id)}
              style={{ ...controlSurface, padding: 9, borderRadius: 8, backgroundColor: section() === id ?
                props.dark ? '#354c78' : '#d5e0f5' : 'transparent' }} hoverStyle={controlHover} focusVisibleStyle={controlFocus}>
              <Text style={{ fontFamily: t.fontFamily, fontSize: 13, color: ink() }}>{label}</Text>
            </Button>)}
        </View>
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {section() === 'models' ? <ModelServices dark={props.dark} defaultModel={props.defaultModel} onModels={props.onModels} /> :
            <Scroll testID="settings-scroll" style={{ flex: 1, minHeight: 0 }} contentStyle={{ padding: 20, gap: 13 }}>
              {appearanceSettings()}
              {appearanceNote()}
            </Scroll>}
        </View>
      </View> : <Scroll testID="settings-scroll" style={{ flex: 1, minHeight: 0 }} contentStyle={{ padding: 20, gap: 13 }}>
        {appearanceSettings()}
        <View style={{ gap: 8 }}>
          <Text style={{ fontFamily: t.fontFamily, color: gold(), fontSize: 14, fontWeight: '600' }}>模型</Text>
          <View style={{ ...card(), padding: 13, gap: 5 }}>
            <Text style={{ fontFamily: t.fontFamily, color: ink(), fontSize: 13 }}>默认模型</Text>
            <Text testID="settings-default-model" class="line-clamp-2" style={{ fontFamily: t.fontFamily, color: muted(), fontSize: 12, lineHeight: 17 }}>{props.defaultModel ?? '暂未提供'}</Text>
            <Text style={{ fontFamily: t.fontFamily, color: muted(), fontSize: 12, lineHeight: 17 }}>在聊天输入栏可为当前会话选择模型和推理等级。</Text>
          </View>
        </View>
        {appearanceNote()}
      </Scroll>}
    </View>
  </Dialog>;
}
