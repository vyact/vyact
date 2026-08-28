import React from 'react';
import ReactDOM from 'react-dom/client';
import {i18nInitialization} from './i18n';
import App from './App';
import {TooltipProvider} from './components/common/Tooltip/Tooltip';
import {refreshGoogleWorkspaceStatus} from './services/googleWorkspaceStatus';
import {initializeKnowledgeCollections} from './services/knowledgeCollectionsCache';
import {installPluginRuntime} from './plugins/installPluginRuntime';
import {applyTheme, getStoredTheme, syncThemeFromServer} from './services/theme';
import './index.css';

applyTheme(getStoredTheme());

async function bootstrapApplication(): Promise<void> {
  await i18nInitialization;
  await syncThemeFromServer();
  installPluginRuntime();

  // Google Workspace 연결 상태는 특정 메뉴가 열릴 때가 아니라 앱 시작 시 한 번 선조회한다.
  // 이후 각 UI는 이 요청/캐시를 공유하고, 연결·해제 이벤트가 있을 때만 다시 확인한다.
  void refreshGoogleWorkspaceStatus().catch(() => {});
  void initializeKnowledgeCollections();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <TooltipProvider><App /></TooltipProvider>
    </React.StrictMode>
  );
}

void bootstrapApplication();
