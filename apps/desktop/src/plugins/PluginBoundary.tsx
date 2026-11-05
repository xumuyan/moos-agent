import { Component, type ErrorInfo, type ReactNode } from 'react';

export default class PluginBoundary extends Component<{ pluginId: string; onError: (id: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { this.props.onError(this.props.pluginId); }
  render() { return this.state.failed ? <span className="plugin-error" role="status">插件内容已隔离</span> : this.props.children; }
}
