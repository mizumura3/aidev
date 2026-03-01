#!/usr/bin/env node
import { createCli } from "./cli.js";

const program = createCli();
program.parse();
