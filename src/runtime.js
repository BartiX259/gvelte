// runtime.js
"use strict";

let activeEffect = null;

function $state(initialValue) {
  return { _value: initialValue, _subscribers: new Set() };
}

function $get(signal) {
  if (activeEffect) {
    activeEffect.dependencies.add(signal);
    signal._subscribers.add(activeEffect);
  }
  return signal._value;
}

function $set(signal, newValue) {
  if (signal._value !== newValue) {
    signal._value = newValue;
    for (const effect of [...signal._subscribers]) {
      effect.execute();
    }
  }
}

function $effect(fn) {
  const effectWrapper = {
    execute: () => {
      for (const dep of effectWrapper.dependencies) {
        dep._subscribers.delete(effectWrapper);
      }
      effectWrapper.dependencies.clear();

      activeEffect = effectWrapper;
      fn();
      activeEffect = null;
    },
    dependencies: new Set(),
  };
  effectWrapper.execute();
}

function $derived(fn) {
  const derivedSignal = $state(undefined);
  $effect(() => {
    $set(derivedSignal, fn());
  });
  return derivedSignal;
}

this.$state = $state;
this.$get = $get;
this.$set = $set;
this.$effect = $effect;
this.$derived = $derived;
