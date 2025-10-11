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

function $notify(signal) {
  for (const effect of [...signal._subscribers]) {
    effect.execute();
  }
}

function is_state_object(value) {
  return (
    value != null &&
    typeof value === "object" &&
    "_value" in value &&
    "_subscribers" in value
  );
}

function $prop(props, key, default_value, is_bindable) {
  const incoming_value = props[key];

  // If this prop is bindable AND the parent passed a valid state object for it...
  if (is_bindable && is_state_object(incoming_value)) {
    // ...then use the parent's state object directly. This creates the two-way binding.
    return incoming_value;
  }

  // Otherwise, fall back to creating a new, local state that is one-way bound.
  const initial = is_state_object(incoming_value)
    ? $get(incoming_value)
    : incoming_value !== undefined
      ? incoming_value
      : default_value;

  const local_state = $state(initial);

  // This effect keeps the local state in sync if the parent's prop changes.
  $effect(() => {
    const updated_incoming_value = props[key];
    if (updated_incoming_value !== undefined) {
      // If the parent passes a state object, we read its value.
      // Otherwise, we use the raw value.
      if (is_state_object(updated_incoming_value)) {
        $set(local_state, $get(updated_incoming_value));
      } else {
        $set(local_state, updated_incoming_value);
      }
    } else {
      // If the prop is removed, revert to the default value.
      $set(local_state, default_value);
    }
  });

  return local_state;
}

this.$state = $state;
this.$get = $get;
this.$set = $set;
this.$effect = $effect;
this.$derived = $derived;
this.$notify = $notify;
this.$prop = $prop;
