import React from 'react';
import { View, ViewStyle } from 'react-native';
import { PersonNodeCard } from './PersonNodeCard';
import type { Person } from '../types/pedigree';

type Props = {
  person: Person;
  label: string;
  width: number;
  onPress: () => void;
  style?: ViewStyle;
  highlighted?: boolean;
  generation?: number;
};

export function DraggablePersonNode({
  person,
  label,
  width,
  onPress,
  style,
  highlighted,
  generation,
}: Props) {
  return (
    <View style={style}>
      <PersonNodeCard
        label={label}
        person={person}
        onPress={onPress}
        highlighted={highlighted}
        generation={generation}
        style={{ width, maxWidth: width, minWidth: width }}
      />
    </View>
  );
}
