module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-worklets/plugin powers Reanimated 4's worklets and MUST be
    // the LAST plugin in the array. (In Reanimated 4 the babel plugin moved out
    // of react-native-reanimated into react-native-worklets.)
    plugins: ['react-native-worklets/plugin'],
  };
};
