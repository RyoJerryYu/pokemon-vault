import Walk from "@root/walk";
import { lstat, mkdir, readFile, writeFile } from "fs/promises";
import matter from "gray-matter";
import { basename, dirname } from "path";
import {
  Ability,
  Move,
  NamedAPIResource,
  Pokemon,
  PokemonSpecies,
  Type,
  VersionGroup,
  VersionGroupDetail,
} from "pokedex-promise-v2";

type VersionFlavorText = {
  flavor_text: string;
  language: NamedAPIResource;
  version_group: NamedAPIResource;
};
const onlySV = (f: VersionFlavorText) =>
  f.version_group.name === "scarlet" || f.version_group.name === "violet";
const onlyZh = (f: VersionFlavorText) => f.language.name === "zh-Hans";

// -> data/api/v2/pokemon/1/index.json
function resourceToDataPathname(resource: NamedAPIResource | string) {
  if (typeof resource === "string") {
    return resource;
  }
  return `api-data/data${resource.url}index.json`;
}
type FetchAllOpts<T> = {
  top?: number;
  filterFunc?: (pathname: string) => boolean;
  fetchFunc?: (pathname: string) => Promise<T>;
};
async function fetchOne<T>(
  resource: string | NamedAPIResource,
  opts?: FetchAllOpts<T>
) {
  const pathname = resourceToDataPathname(resource);
  if (opts?.fetchFunc) {
    return await opts.fetchFunc(pathname);
  }
  const fileRaw = await readFile(pathname, "utf8");
  return JSON.parse(fileRaw) as T;
}
async function fetchAll<T>(
  resource: string | NamedAPIResource,
  opts?: FetchAllOpts<T>
) {
  const pathname = resourceToDataPathname(resource);
  const pathnames: string[] = [];
  await Walk.walk(pathname, async (err, pathname, dirent) => {
    if (dirent.isDirectory()) return;
    if (opts?.filterFunc) {
      if (!opts.filterFunc(pathname)) return;
    }

    pathnames.push(pathname);
  });

  pathnames.sort();

  if (opts?.top) {
    pathnames.splice(opts.top);
  }

  const promises = pathnames.map(async (pathname) => fetchOne(pathname, opts));

  return await Promise.all(promises);
}

async function saveAsFrontMatter(
  pathname: string,
  data: Object,
  content: string
) {
  const raw = matter.stringify(content, data);
  const dir = dirname(pathname);

  const dirExists = async (pathname: string) => {
    try {
      const stat = await lstat(pathname);
      return stat.isDirectory();
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return false;
      } else {
        throw err;
      }
    }
  };
  if (!(await dirExists(dir))) {
    await mkdir(dir, { recursive: true });
  }

  return await writeFile(pathname, raw);
}

// -> 1_bulbasaur
function resourceToMDName(resource: NamedAPIResource) {
  const id = basename(resource.url);
  return `${id}_${resource.name}`;
}
// -> pokemon/bulbasaur
function resourceToAliasName(resource: NamedAPIResource) {
  const resourceType = basename(dirname(resource.url));
  return `${resourceType}/${resource.name}`;
}
// -> [[1_bulbasaur|pokemon/bulbasaur]]
function resourceToAliasReference(resource: NamedAPIResource) {
  return `[[${resourceToMDName(resource)}|${resourceToAliasName(resource)}]]`;
}
type Transformer<T> = {
  logName: string;
  fetchPathname: string;
  filterFunc?: (pathname: string) => boolean;
  saveDir: string;
  transformFunc: (
    resource: T,
    thisResource: NamedAPIResource
  ) => Promise<{ frontMatter: Object; content: string }>;
};

interface FetchResult {
  id: number;
  name: string;
}
async function transform<T extends FetchResult>(
  transformer: Transformer<T>,
  top?: number
) {
  const allFetched = await fetchAll<T>(transformer.fetchPathname, {
    top: top,
    filterFunc: transformer.filterFunc,
  });

  console.log(`all ${transformer.logName}:`, allFetched.length);

  const saveAll = allFetched.map(async (resource) => {
    const thisResource: NamedAPIResource = {
      name: resource.name,
      url: `${transformer.fetchPathname}/${resource.id}/`,
    };
    const { frontMatter, content } = await transformer.transformFunc(
      resource,
      thisResource
    );

    return await saveAsFrontMatter(
      `${transformer.saveDir}/${resourceToMDName(thisResource)}.md`,
      frontMatter,
      content
    );
  });

  await Promise.all(saveAll);
}

const pokemonTransformer: Transformer<Pokemon> = {
  logName: "pokemon",
  fetchPathname: "api-data/data/api/v2/pokemon",
  filterFunc: (pathname) =>
    basename(dirname(pathname)) !== "encounters" &&
    basename(dirname(pathname)) !== "pokemon",
  saveDir: "gen/pokemon",
  transformFunc: async (pokemon, thisResource) => {
    const stats: Record<string, number> = {};
    pokemon.stats.forEach((s) => {
      stats[s.stat.name] = s.base_stat;
    });

    const frontMatter: { [key: string]: any } = {
      id: pokemon.id,
      name: pokemon.name,
      abilities: pokemon.abilities.map((a) => a.ability.name),
      // moves: pokemon.moves.map((m) => m.move.name),
      // species: pokemon.species.name,
      stats: stats,
      types: pokemon.types.map((t) => t.type.name),
    };

    const species = await fetchOne<PokemonSpecies>(pokemon.species);
    frontMatter["zh_name"] =
      species.names.find((name) => name.language.name === "zh-Hans")?.name ??
      null;
    frontMatter["jp_name"] =
      species.names.find((name) => name.language.name === "ja-Hrkt")?.name ??
      null;
    frontMatter["kr_name"] =
      species.names.find((name) => name.language.name === "ko")?.name ?? null;

    const aliases = species.names.map((name) => name.name);
    aliases.push(pokemon.name);
    aliases.push(`pokemon/${pokemon.id.toString()}`);
    aliases.push(`${resourceToAliasName(thisResource)}`);
    frontMatter["aliases"] = aliases;

    const iconStatements = `![](${pokemon.sprites.front_default})`;
    const nameStatements = species.names.map((name) => name.name).join(" | ");
    const typeStatements = pokemon.types
      .map((t) => resourceToAliasReference(t.type))
      .join(" | ");
    const abilityStatements = pokemon.abilities
      .map((a) => resourceToAliasReference(a.ability))
      .join(" | ");

    const statsStatements = `|stat|value|
|---|---|
|hp|${stats.hp}|
|attack|${stats.attack}|
|defense|${stats.defense}|
|special-attack|${stats["special-attack"]}|
|special-defense|${stats["special-defense"]}|
|speed|${stats.speed}|
`;
    const moveStatements = pokemon.moves
      .map((m) => `- ${resourceToAliasReference(m.move)}`)
      .join("\n");

    const flavorTextStatements = species.flavor_text_entries
      .filter((f) => f.language.name === "zh-Hans")
      .map(
        (f) => `### ${f.language.name}/${f.version.name}\n\n${f.flavor_text}`
      )
      .join("\n\n");
    const form_descriptionsStatements = species.form_descriptions
      .filter((f) => f.language.name === "zh-Hans")
      .map((f) => f.description)
      .join("\n\n");
    const formsStatements = pokemon.forms
      .map((f) => `${resourceToAliasReference(f)}`)
      .join(" | ");

    const content = `# ${pokemon.name}

${iconStatements}

${nameStatements}

${typeStatements}

${abilityStatements}

${statsStatements}

## Moves

${moveStatements}

## Forms

${form_descriptionsStatements}

${formsStatements}

## Description

${flavorTextStatements}

`;
    return { frontMatter, content };
  },
};

const typeTransformer: Transformer<Type> = {
  logName: "type",
  fetchPathname: "api-data/data/api/v2/type",
  saveDir: "gen/type",
  filterFunc: (pathname) => basename(dirname(pathname)) !== "type",
  transformFunc: async (type, thisResource) => {
    const frontMatter: { [key: string]: any } = {
      id: type.id,
      name: type.name,
      double_damage_from: type.damage_relations.double_damage_from.map(
        (t) => t.name
      ),
      double_damage_to: type.damage_relations.double_damage_to.map(
        (t) => t.name
      ),
      half_damage_from: type.damage_relations.half_damage_from.map(
        (t) => t.name
      ),
      half_damage_to: type.damage_relations.half_damage_to.map((t) => t.name),
      no_damage_from: type.damage_relations.no_damage_from.map((t) => t.name),
      no_damage_to: type.damage_relations.no_damage_to.map((t) => t.name),
    };

    frontMatter["zh_name"] =
      type.names.find((name) => name.language.name === "zh-Hans")?.name ?? null;
    frontMatter["jp_name"] =
      type.names.find((name) => name.language.name === "ja-Hrkt")?.name ?? null;
    frontMatter["kr_name"] =
      type.names.find((name) => name.language.name === "ko")?.name ?? null;

    const aliases = type.names.map((name) => name.name);
    aliases.push(type.name);
    aliases.push(`type/${type.id.toString()}`);
    aliases.push(`${resourceToAliasName(thisResource)}`);
    frontMatter["aliases"] = aliases;

    const nameStatements = type.names.map((name) => name.name).join(" | ");
    const double_damage_fromStatements =
      type.damage_relations.double_damage_from
        .map((t) => `${resourceToAliasReference(t)}`)
        .join(" | ");
    const double_damage_toStatements = type.damage_relations.double_damage_to
      .map((t) => `${resourceToAliasReference(t)}`)
      .join(" | ");
    const half_damage_fromStatements = type.damage_relations.half_damage_from
      .map((t) => `${resourceToAliasReference(t)}`)
      .join(" | ");
    const half_damage_toStatements = type.damage_relations.half_damage_to
      .map((t) => `${resourceToAliasReference(t)}`)
      .join(" | ");
    const no_damage_fromStatements = type.damage_relations.no_damage_from
      .map((t) => `${resourceToAliasReference(t)}`)
      .join(" | ");
    const no_damage_toStatements = type.damage_relations.no_damage_to
      .map((t) => `${resourceToAliasReference(t)}`)
      .join(" | ");

    const pokemonStatements = type.pokemon
      .map((p) => `- ${resourceToAliasReference(p.pokemon)}`)
      .join("\n");
    const moveStatements = type.moves
      .map((m) => `- ${resourceToAliasReference(m)}`)
      .join("\n");

    const content = `# ${type.name}

${nameStatements}

## Damage Relations

From:
- x2: ${double_damage_fromStatements}
- x0.5: ${half_damage_fromStatements}
- x0: ${no_damage_fromStatements}

To:
- x2: ${double_damage_toStatements}
- x0.5: ${half_damage_toStatements}
- x0: ${no_damage_toStatements}

## Pokemon

${pokemonStatements}

## Moves

${moveStatements}

`;
    return { frontMatter, content };
  },
};

const abilityTransformer: Transformer<Ability> = {
  logName: "ability",
  fetchPathname: "api-data/data/api/v2/ability",
  saveDir: "gen/ability",
  filterFunc: (pathname) => basename(dirname(pathname)) !== "ability",
  transformFunc: async (ability, thisResource) => {
    const frontMatter: { [key: string]: any } = {
      id: ability.id,
      name: ability.name,
    };

    frontMatter["zh_name"] =
      ability.names.find((name) => name.language.name === "zh-Hans")?.name ??
      null;
    frontMatter["jp_name"] =
      ability.names.find((name) => name.language.name === "ja-Hrkt")?.name ??
      null;
    frontMatter["kr_name"] =
      ability.names.find((name) => name.language.name === "ko")?.name ?? null;

    const aliases = ability.names.map((name) => name.name);
    aliases.push(ability.name);
    aliases.push(`ability/${ability.id.toString()}`);
    aliases.push(`${resourceToAliasName(thisResource)}`);
    frontMatter["aliases"] = aliases;

    const nameStatements = ability.names.map((name) => name.name).join(" | ");
    const descriptionStatements = ability.flavor_text_entries
      .filter(onlyZh)
      .map(
        (f) =>
          `### ${f.language.name}/${f.version_group.name}\n\n${f.flavor_text}`
      )
      .join("\n\n");

    const pokemonStatements = ability.pokemon
      .map((p) => `- ${resourceToAliasReference(p.pokemon)}`)
      .join("\n");

    const content = `# ${ability.name}

${nameStatements}

## Description

${descriptionStatements}

## Pokemon

${pokemonStatements}

`;
    return { frontMatter, content };
  },
};

const moveTransformer: Transformer<Move> = {
  logName: "move",
  fetchPathname: "api-data/data/api/v2/move",
  saveDir: "gen/move",
  filterFunc: (pathname) => basename(dirname(pathname)) !== "move",
  transformFunc: async (move, thisResource) => {
    const frontMatter: { [key: string]: any } = {
      id: move.id,
      name: move.name,
      type: move.type.name,
      power: move.power,
      pp: move.pp,
      priority: move.priority,
      accuracy: move.accuracy,
      damage_class: move.damage_class.name,
    };

    frontMatter["zh_name"] =
      move.names.find((name) => name.language.name === "zh-Hans")?.name ?? null;
    frontMatter["jp_name"] =
      move.names.find((name) => name.language.name === "ja-Hrkt")?.name ?? null;
    frontMatter["kr_name"] =
      move.names.find((name) => name.language.name === "ko")?.name ?? null;

    const aliases = move.names.map((name) => name.name);
    aliases.push(move.name);
    aliases.push(`move/${move.id.toString()}`);
    aliases.push(`${resourceToAliasName(thisResource)}`);
    frontMatter["aliases"] = aliases;

    const nameStatements = move.names.map((name) => name.name).join(" | ");
    const typeStatements = resourceToAliasReference(move.type);
    const effectStatements = move.effect_entries
      .map((e) => e.effect)
      .join("\n\n");
    const descriptionStatements = move.flavor_text_entries
      .filter(onlySV)
      .map(
        (f) =>
          `### ${f.language.name}/${f.version_group.name}\n\n${f.flavor_text}`
      )
      .join("\n\n");

    const pokemonStatements = move.learned_by_pokemon
      .map((p) => `- ${resourceToAliasReference(p)}`)
      .join("\n");

    const content = `# ${move.name}
    
${nameStatements}

${typeStatements}

## Effect

${effectStatements}

## Description

${descriptionStatements}

## Pokemon

${pokemonStatements}

`;
    return { frontMatter, content };
  },
};

async function main() {
  await Promise.all([
    transform(pokemonTransformer),
    transform(typeTransformer),
    transform(abilityTransformer),
    transform(moveTransformer),
  ]);
}

main();
