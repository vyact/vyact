import React from 'react';
import ReactDOM from 'react-dom/client';
import {i18nInitialization} from './i18n';
import App from './App';
import {TooltipProvider} from './components/common/Tooltip/Tooltip';
import {installPluginRuntime} from './plugins/installPluginRuntime';
import {applyTheme, getStoredTheme, syncThemeFromServer} from './services/theme';
import './index.css';
import './plugins/pluginThemeOverrides.css';

applyTheme(getStoredTheme());

async function bootstrapApplication(): Promise<void> {
  await i18nInitialization;
  await syncThemeFromServer();
  installPluginRuntime();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <TooltipProvider><App /></TooltipProvider>
    </React.StrictMode>
  );
}

void bootstrapApplication();
