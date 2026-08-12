import { useState, useCallback } from "react";
import { useTranslation } from "../i18n";

export const usePermissions = (showAlertDialog) => {
  const { t } = useTranslation();
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [accessibilityPermissionGranted, setAccessibilityPermissionGranted] = useState(false);

  const requestMicPermission = useCallback(async () => {
    let permissionStream = null;
    try {
      permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermissionGranted(true);
      if (showAlertDialog) {
        showAlertDialog({
          title: t('permissions.micTestSuccessTitle'),
          description: t('permissions.micTestSuccessDesc')
        });
      } else {
        alert(t('permissions.micTestSuccessDesc'));
      }
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', '麦克风权限被拒绝:', err);
      }
      setMicPermissionGranted(false);
      if (showAlertDialog) {
        showAlertDialog({
          title: t('permissions.micNeededTitle'),
          description: t('permissions.micNeededDesc')
        });
      } else {
        alert(t('permissions.micNeededDesc'));
      }
    } finally {
      // 權限測試只需要確認能否取得串流；成功後不可繼續占用系統麥克風。
      permissionStream?.getTracks().forEach((track) => track.stop());
    }
  }, [showAlertDialog, t]);

  const testAccessibilityPermission = useCallback(async () => {
    try {
      await window.electronAPI.pasteText(t('permissions.testText'));
      setAccessibilityPermissionGranted(true);
      if (showAlertDialog) {
        showAlertDialog({
          title: t('permissions.accTestSuccessTitle'),
          description: t('permissions.accTestSuccessDesc')
        });
      } else {
        alert(t('permissions.accTestSuccessDesc'));
      }
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', '辅助功能权限测试失败:', err);
      }
      setAccessibilityPermissionGranted(false);
      if (showAlertDialog) {
        showAlertDialog({
          title: t('permissions.accNeededTitle'),
          description: t('permissions.accNeededDesc')
        });
      } else {
        alert(t('permissions.accNeededDesc'));
      }
    }
  }, [showAlertDialog, t]);

  return {
    micPermissionGranted,
    accessibilityPermissionGranted,
    requestMicPermission,
    testAccessibilityPermission,
    setMicPermissionGranted,
    setAccessibilityPermissionGranted,
  };
};
