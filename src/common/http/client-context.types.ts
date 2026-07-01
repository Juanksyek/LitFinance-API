export type AppPlatform = 'android' | 'ios';

export type AppVersionValidation = {
  isValid: boolean;
  isActive: boolean;
  needsUpdate: boolean;
  forceUpdate: boolean;
  message?: string;
  storeUrl?: string;
  latestVersion?: string;
  minRequiredVersion?: string;
  releaseNotes?: string;
};

export type ClientContext = {
  deviceId: string;
  appVersion: string;
  appBuild: string | null;
  platform: AppPlatform;
  versionValidation: AppVersionValidation;
};
